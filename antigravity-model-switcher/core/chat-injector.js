/**
 * Antigravity 聊天界面模型选择器注入与同会话无缝切换引擎 (`chat-injector.js`)
 * --------------------------------------------------------------------------
 * 核心功能：
 * 1. 在左侧边栏【个性化定制】下方挂载【接入中转 API】功能入口（与原生导航项样式完全一致）；
 * 2. 点击【接入中转 API】打开中转模型管理面板：支持添加模型（显示名称、Model ID、Base URL、API Key、协议类型）、一键【🔌 测试连接】、编辑与【🗑️ 删除】模型；
 * 3. 添加后的模型自动以原生菜单项样式展示在聊天框的模型选择面板 (`[data-testid="model-selector-panel"]`) 中（未添加任何模型时不显示多余区块或按钮，输入框加号旁也不显示任何多余按钮）；
 * 4. 实现 WorkBuddy 风格的同会话双向无缝切换：
 *    - 当切换到【自定义中转模型】时：自动提取当前对话的官方历史（经无状态消毒，剥离加密签名与不兼容工具块），发送给中转 API 并在当前对话流中直接渲染回复气泡；
 *    - 当从【自定义中转模型】切回【Google 官方模型】时：自动将未同步的中转模型对话轮次桥接注入下一条提问上下文（并在界面气泡中隐藏底层同步标记），无需新开对话即可无缝继续。
 */

(function () {
    'use strict';

    const API_BASE = 'http://127.0.0.1:19823/api/models';
    const SKIP_I18N_ATTR = 'data-ag-localization-skip';
    let disposed = false;
    let refreshSequence = 0;
    let selectionSequence = 0;
    let selectionPending = false;
    let selectionQueue = Promise.resolve();
    let activeChatController = null;
    let activeChatConversationId = null;
    let activeRunStatus = null;
    let bridgingOfficial = false;
    let replayingOfficial = false;
    const nativeOverlays = new Map();
    const liveNativeTurns = new Map();
    const nativeRenderIds = new Map();
    const nativeHistoryByConversation = new Map();
    let nativeCreation = null;
    let legacyMigration = null;
    const nativeAdapterCleanups = [];
    const modelPanelBindings = new WeakSet();
    const deletedConversations = new Set();
    const confirmedDeletes = new Set();
    const nativeWrites = new Map();
    const pendingDeletes = new Map();
    const deletingConversations = new Map();
    let restoreNativeFetch = () => {};

    function forgetNativeConversation(cid) {
        deletedConversations.add(cid);
        nativeHistoryByConversation.delete(cid);
        if (activeChatConversationId === cid) activeChatController?.abort(new Error('会话已删除'));
        for (const [key, exchange] of liveNativeTurns) if (exchange.conversationId === cid) liveNativeTurns.delete(key);
        for (const [provider, entry] of nativeOverlays) {
            if (entry.conversationId !== cid) continue;
            clearTimeout(entry.timer);
            entry.receive?.dispose?.();
            provider.setState = entry.originalSet;
            provider.requestPageUpdate = () => Promise.resolve();
            nativeOverlays.delete(provider);
        }
        nativeContext().composer?.draftsRef.current?.delete(cid);
    }

    // Native RPC uses Connect JSON frames. Observe the actual successful delete,
    // including calls made by already-mounted native menus, instead of DOM removal.
    function nativeRpcBody(body) {
        try {
            if (typeof body === 'string') return JSON.parse(body);
            if (!(body instanceof Uint8Array) || body.length < 5) return null;
            const size = new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(1);
            if (size > body.length - 5) return null;
            return JSON.parse(new TextDecoder().decode(body.subarray(5, 5 + size)));
        } catch { return null; }
    }

    function nativeRpcEncoded(data, framed = true, flags = 0) {
        const bytes = new TextEncoder().encode(JSON.stringify(data));
        if (!framed) return JSON.stringify(data);
        const frame = new Uint8Array(bytes.length + 5);
        frame[0] = flags; new DataView(frame.buffer).setUint32(1, bytes.length); frame.set(bytes, 5);
        return frame;
    }

    function nativeEmptyRpcResponse(framed) {
        if (!framed) return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
        const data = nativeRpcEncoded({}), trailer = nativeRpcEncoded({}, true, 2);
        const bytes = new Uint8Array(data.length + trailer.length); bytes.set(data); bytes.set(trailer, data.length);
        return new Response(bytes, { headers: { 'Content-Type': 'application/connect+json' } });
    }

    async function nativeRpcSucceeded(response) {
        if (!response.ok) return false;
        const bytes = new Uint8Array(await response.clone().arrayBuffer());
        if (!bytes.length) return true;
        if (response.headers.get('content-type')?.includes('application/json')) {
            const data = JSON.parse(new TextDecoder().decode(bytes));
            return !data.error && !data.code;
        }
        for (let offset = 0; offset + 5 <= bytes.length;) {
            const flags = bytes[offset];
            const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 5).getUint32(1);
            if (offset + 5 + length > bytes.length) return false;
            if (flags & 2) {
                const trailer = JSON.parse(new TextDecoder().decode(bytes.subarray(offset + 5, offset + 5 + length)));
                if (trailer.error) return false;
            }
            offset += 5 + length;
        }
        return true;
    }

    async function persistNativeDeletion(cid) {
        if (pendingDeletes.has(cid)) return pendingDeletes.get(cid);
        const operation = apiFetch('/bridge/delete', { method: 'POST', body: { conversationId: cid } })
            .then(() => {
                const pending = JSON.parse(localStorage.getItem('agy-ms-pending-deletes') || '[]').filter(id => id !== cid);
                localStorage.setItem('agy-ms-pending-deletes', JSON.stringify(pending));
            }).finally(() => pendingDeletes.delete(cid));
        pendingDeletes.set(cid, operation);
        return operation;
    }

    function installNativeDeletionTracking() {
        const original = window.fetch;
        const tracked = async function (input, options) {
            const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
            const method = url.pathname.split('/').at(-1);
            if (url.origin !== location.origin || !url.pathname.includes('/exa.language_server_pb.LanguageServerService/') ||
                !['DeleteCascadeTrajectory', 'JetboxDeleteSummary', 'JetboxWriteSummary', 'UpdateConversationAnnotations', 'GetTurnDiff'].includes(method)) {
                return original.apply(this, arguments);
            }
            if (method === 'GetTurnDiff') {
                const data = nativeRpcBody(options?.body);
                const entry = [...nativeOverlays.values()].find(item => item.conversationId === data?.conversationId && item.provider.getState().__agyNativeProjection);
                if (!entry || !Number.isInteger(data.stepIndex)) return original.apply(this, arguments);
                const mapped = nativeLayout(entry.base, collectNativeExchanges(entry.conversationId), entry.conversationId).officialAt(data.stepIndex);
                const framed = options.body instanceof Uint8Array;
                if (mapped == null) return nativeEmptyRpcResponse(framed);
                return original.call(this, input, { ...options, body: nativeRpcEncoded({ ...data, stepIndex: mapped }, framed) });
            }
            const cid = nativeRpcBody(options?.body)?.cascadeId;
            if (!/^[a-f0-9-]{36}$/i.test(cid || '')) return original.apply(this, arguments);
            const deleting = method === 'DeleteCascadeTrajectory' || method === 'JetboxDeleteSummary';
            if (!deleting && (deletedConversations.has(cid) || deletingConversations.has(cid))) {
                return new Response(JSON.stringify({ code: 'not_found', message: '会话已删除' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
            }
            if (deleting) {
                // Freeze this request's UUID before waiting for writes. Do not
                // dispose history/providers until physical deletion succeeds.
                const deletionOptions = { ...options, body: nativeRpcEncoded({ cascadeId: cid }, options?.body instanceof Uint8Array) };
                deletingConversations.set(cid, (deletingConversations.get(cid) || 0) + 1);
                await Promise.allSettled([...(nativeWrites.get(cid) || [])]);
                try {
                    const response = await original.call(this, input, deletionOptions);
                    if (await nativeRpcSucceeded(response)) {
                        // Deleting the summary can open/cache the trajectory again.
                        // Finish with physical deletion after that operation, so the
                        // next startup cannot rediscover an empty SQLite trajectory.
                        if (method === 'JetboxDeleteSummary') {
                            const cleanupUrl = new URL(url);
                            cleanupUrl.pathname = cleanupUrl.pathname.replace(/JetboxDeleteSummary$/, 'DeleteCascadeTrajectory');
                            const cleanup = await original.call(this, cleanupUrl.href, deletionOptions);
                            if (!await nativeRpcSucceeded(cleanup)) throw new Error('会话摘要已删除，但会话文件清理失败');
                        }
                        forgetNativeConversation(cid);
                        const holder = nativeContext().states?.getAgentStates().get(cid);
                        holder?.link?.dispose?.();
                        holder?.underlyingProvider?.dispose?.();
                        confirmedDeletes.add(cid);
                        localStorage.setItem('agy-ms-deleted-conversations', JSON.stringify([...confirmedDeletes]));
                        const pending = new Set(JSON.parse(localStorage.getItem('agy-ms-pending-deletes') || '[]'));
                        pending.add(cid);
                        localStorage.setItem('agy-ms-pending-deletes', JSON.stringify([...pending]));
                        await persistNativeDeletion(cid).catch(error => showError(`中转记录删除同步失败，将自动重试：${error.message}`, cid));
                    } else if (!confirmedDeletes.has(cid)) deletedConversations.delete(cid);
                    return response;
                } catch (error) { if (!confirmedDeletes.has(cid)) deletedConversations.delete(cid); throw error; }
                finally {
                    const remaining = (deletingConversations.get(cid) || 1) - 1;
                    if (remaining) deletingConversations.set(cid, remaining); else deletingConversations.delete(cid);
                }
            }
            const writes = nativeWrites.get(cid) || new Set();
            nativeWrites.set(cid, writes);
            const operation = original.apply(this, arguments);
            const settled = operation.then(async response => {
                if (!await nativeRpcSucceeded(response)) throw new Error('原生会话写入失败');
            });
            writes.add(settled);
            settled.then(() => writes.delete(settled), () => writes.delete(settled));
            return operation;
        };
        window.fetch = tracked;
        restoreNativeFetch = () => { if (window.fetch === tracked) window.fetch = original; };
        try {
            for (const cid of JSON.parse(localStorage.getItem('agy-ms-deleted-conversations') || '[]')) {
                if (/^[a-f0-9-]{36}$/i.test(cid)) { deletedConversations.add(cid); confirmedDeletes.add(cid); }
            }
            for (const cid of JSON.parse(localStorage.getItem('agy-ms-pending-deletes') || '[]')) {
                if (/^[a-f0-9-]{36}$/i.test(cid)) deletedConversations.add(cid);
            }
        } catch {}
    }

    // Discover the actual application providers instead of creating a second chat UI.
    function nativeContext(element = document.querySelector('[data-lexical-editor="true"]')) {
        let fiber = element?.[Object.keys(element).find(key => key.startsWith('__reactFiber'))];
        const context = {};
        while (fiber) {
            const value = fiber.memoizedProps?.value;
            if (value && typeof value === 'object') {
                if (value.startCascade && value.createAgentStateProviderForConvo) context.service = value;
                if (value.getAgentStates && value.peek) context.states = value;
                if (value.trajectorySummariesProvider) context.summaries = value.trajectorySummariesProvider;
                if (value.navigate && value.buildLocation) context.router = value;
                if (value.getStepRendererConfig) context.render = value;
                if (value.getLexicalEditor && value.draftsRef && value.inputBoxRef) context.composer = value;
            }
            fiber = fiber.return;
        }
        return context;
    }

    function nativeTimestamp(ms = Date.now()) {
        return { seconds: BigInt(Math.floor(ms / 1000)), nanos: (ms % 1000) * 1000000 };
    }

    async function createNativeConversation(title, sourceId = '') {
        const context = nativeContext();
        if (!context.service || !context.summaries || !context.router) return null;
        if (sourceId) {
            const source = await apiFetch(`/bridge/info?conversationId=${encodeURIComponent(sourceId)}`);
            if (source.deletedAt) throw new Error('旧会话已删除');
            if (source.migratedTo) return { cid: source.migratedTo, context };
        }
        const id = crypto.randomUUID();
        const result = await context.service.startCascade({ cascadeId: id, source: 1, workspaceUris: [] });
        let cid = result.cascadeId;
        let didMigrate = false;
        if (!cid) throw new Error('原生会话创建失败');
        try {
            if (sourceId) {
                const migrated = await apiFetch('/bridge/migrate', { method: 'POST', body: { sourceId, conversationId: cid } });
                didMigrate = migrated.conversationId === cid;
                if (migrated.conversationId !== cid) {
                    await context.service.deleteCascadeTrajectory(cid);
                    await context.service.deleteSummary({ cascadeId: cid });
                    return { cid: migrated.conversationId, context };
                }
            }
            await context.service.updateConversationAnnotations(cid, { title: title.slice(0, 80), lastUserViewTime: nativeTimestamp() }, true);
            context.summaries.pushUpdate({ type: 'create', cascadeId: cid, workspaceUris: [], createdAt: new Date(), initialText: title.slice(0, 80), projectId: 'outside-of-project' });
            await Promise.all([...(nativeWrites.get(cid) || [])]);
        } catch (error) {
            // Keep a successfully migrated conversation available even if its title update fails.
            if (!didMigrate) {
                await context.service.deleteCascadeTrajectory(cid).catch(() => {});
                await context.service.deleteSummary({ cascadeId: cid }).catch(() => {});
            }
            throw error;
        }
        return { cid, context };
    }

    async function ensureNativeConversation(prompt) {
        if ((window.location.pathname || '').startsWith('/c/')) return getActiveConversationId();
        if (nativeCreation) return nativeCreation;
        nativeCreation = (async () => {
            const sourceId = state.activeLocalSessionId && state.bridge?.conversationId === getActiveConversationId() && state.bridge.exchanges?.length ? getActiveConversationId() : '';
            const created = await createNativeConversation(prompt, sourceId);
            if (!created) return getActiveConversationId(); // Compatibility for older application versions.
            const oldEditor = document.querySelector('[data-lexical-editor="true"]');
            clearSubmittedComposer(oldEditor, '__home__');
            await created.context.router.navigate({ to: '/c/$cascadeId', params: { cascadeId: created.cid }, search: { section: 'outside-of-project' } });
            // The old editor's unmount effect can save its draft again during navigation.
            created.context.composer?.draftsRef.current?.delete('__home__');
            const deadline = Date.now() + 10000;
            while (Date.now() < deadline && (!document.querySelector(`[data-testid="conversation-view"][data-cascade-id="${created.cid}"]`) || !nativeContext().states?.peek(created.cid))) {
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            if (!nativeContext().states?.peek(created.cid)) throw new Error('原生会话尚未就绪，请重试');
            state.activeLocalSessionId = null;
            sessionStorage.removeItem('agy-ms-local-session');
            document.getElementById('agy-ms-startpage-chat-log')?.remove();
            await refreshState();
            return created.cid;
        })();
        try { return await nativeCreation; } finally { nativeCreation = null; }
    }

    function nativeTrajectoryId(exchange, cid) {
        return `relay-${nativeRenderIds.get(`${cid}:${exchange.id}`)?.id || exchange.id}`;
    }

    function nativeExchangeStepCount(exchange) {
        return 2 + (exchange.reasoning ? 1 : 0) + (exchange.toolSteps?.length || 0) + (exchange.error ? 1 : 0);
    }

    // A complete index map, including relay turns outside the currently loaded native page.
    function nativeLayout(base, exchanges, cid) {
        const total = base?.trajectorySlice?.totalStepsLength || 0;
        const ordered = exchanges.slice().sort((a, b) => (a.afterOfficialStepIndex ?? -1) - (b.afterOfficialStepIndex ?? -1) || a.createdAt - b.createdAt);
        const ranges = []; let added = 0;
        for (const exchange of ordered) {
            const anchor = Math.min(total - 1, Math.max(-1, exchange.afterOfficialStepIndex ?? -1));
            const count = nativeExchangeStepCount(exchange);
            const start = anchor + 1 + added;
            ranges.push({ anchor, start, end: start + count }); added += count;
        }
        return { total, ranges, displayTotal: total + added,
            officialAt(index) {
                if (index < 0 || index >= total + added || ranges.some(range => index >= range.start && index < range.end)) return null;
                return index - ranges.filter(range => range.end <= index).reduce((n, range) => n + range.end - range.start, 0);
            },
            boundary(index) {
                const range = ranges.find(range => index >= range.start && index < range.end);
                if (range) return range.anchor + 1;
                return Math.min(total, Math.max(0, index - ranges.filter(range => range.end <= index).reduce((n, range) => n + range.end - range.start, 0)));
            }
        };
    }

    function makeNativeExchangeSteps(exchange, cid, offset, cache) {
        const createdAt = nativeRenderIds.get(`${cid}:${exchange.id}`)?.createdAt || exchange.createdAt || Date.now();
        const cacheKey = nativeTrajectoryId(exchange, cid);
        const snapshot = { offset, createdAt, userPrompt: exchange.userPrompt, assistantReply: exchange.assistantReply,
            reasoning: exchange.reasoning, running: exchange.running, phase: exchange.phase, latencyMs: exchange.latencyMs, error: exchange.error };
        const images = exchange.images || [], tools = exchange.toolSteps || [];
        const cached = cache?.exchanges.get(cacheKey);
        const sameRefs = (a, b) => a.length === b.length && a.every((item, index) => item === b[index]);
        const sameImages = cached && images.length === cached.images.length && images.every((item, index) => item === cached.images[index] ||
            item.dataUrl === cached.images[index]?.dataUrl && item.mediaType === cached.images[index]?.mediaType);
        const sameTools = cached && (sameRefs(tools, cached.tools) || JSON.stringify(tools) === cached.toolSignature);
        if (cached && Object.keys(snapshot).every(key => snapshot[key] === cached.snapshot[key]) && sameImages && sameTools) {
            cached.images = images.slice(); cached.tools = tools.slice();
            return cached.steps;
        }
        const timestamp = nativeTimestamp(createdAt);
        const metadata = (suffix, extra = {}) => ({
            $typeName: 'exa.cortex_pb.CortexStepMetadata', createdAt: timestamp,
            ...(exchange.running || !exchange.latencyMs ? {} : { completedAt: nativeTimestamp(createdAt + exchange.latencyMs) }),
            argumentsOrder: [], retryInfos: [], toolCallChoices: [], nonStandardCreditReasons: [], preToolHookResults: [],
            // Synthetic steps have a separate trajectory, so native actions cannot address official steps.
            sourceTrajectoryStepInfo: { cascadeId: cid, trajectoryId: nativeTrajectoryId(exchange, cid), stepIndex: offset + suffix },
            ...extra
        });
        const step = (type, name, value, index, status = 3, extra = {}) => ({
            $typeName: 'gemini_coder.Step', type, status, completedInteractions: [],
            metadata: metadata(index, extra), step: { case: name, value: name === 'plannerResponse' ? { thinking: '', rawThinking: '', response: '', toolCalls: [], ...value } : value }, __agyRelay: true
        });
        const user = {
            $typeName: 'exa.cortex_pb.CortexStepUserInput',
            items: [{ $typeName: 'exa.codeium_common_pb.TextOrScopeItem', chunk: { case: 'text', value: stripBridgeMarkers(exchange.userPrompt) } }],
            userResponse: stripBridgeMarkers(exchange.userPrompt), artifactComments: [], fileDiffComments: [], fileComments: [], sideChannels: [], tags: [], images: [],
            media: (exchange.images || []).filter(image => image.dataUrl).map(image => ({
                $typeName: 'exa.codeium_common_pb.Media', mimeType: image.mediaType || 'image/png', uri: image.dataUrl, payload: { case: undefined }
            }))
        };
        const result = [step(14, 'userInput', user, 0)];
        if (exchange.reasoning) result.push(step(15, 'plannerResponse', { rawThinking: exchange.reasoning, response: '' }, result.length, exchange.running && (!exchange.phase || exchange.phase === 'thinking') ? 2 : 3));
        for (const tool of exchange.toolSteps || []) {
            const args = Object.fromEntries(Object.entries(tool.args || {}).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]));
            result.push(step(132, 'generic', { args, result: { result: String(tool.output || tool.summary || ''), isError: tool.ok === false }, name: tool.name }, result.length, tool.running ? 2 : tool.ok === false ? 7 : 3, { toolCall: { name: tool.name }, toolAction: tool.summary || tool.name, toolSummary: tool.summary || tool.name }));
        }
        result.push(step(15, 'plannerResponse', { response: exchange.assistantReply || '', rawThinking: '' }, result.length, exchange.running ? 2 : 3));
        if (exchange.error) result.push(step(15, 'plannerResponse', { response: `**${exchange.error}**`, rawThinking: '' }, result.length));
        if (cached && cached.snapshot.offset === offset && cached.snapshot.createdAt === createdAt && cached.snapshot.userPrompt === exchange.userPrompt && sameImages) result[0] = cached.steps[0];
        const stepSignatures = result.map(item => JSON.stringify(item, (_key, value) => typeof value === 'bigint' ? value.toString() : value));
        if (cached) result.forEach((item, index) => {
            if (stepSignatures[index] === cached.stepSignatures?.[index]) result[index] = cached.steps[index];
        });
        cache?.exchanges.set(cacheKey, { snapshot, images: images.slice(), tools: tools.slice(), toolSignature: JSON.stringify(tools), steps: result, stepSignatures });
        return result;
    }

    function projectNativeState(base, exchanges, cid, cache) {
        const slice = base?.trajectorySlice;
        if (!slice || !exchanges.length) return base;
        const original = slice.stepsInSlice || [];
        const start = original[0]?.metadata?.sourceTrajectoryStepInfo?.stepIndex ?? Math.max(0, slice.stepsSlice?.startIndex || 0);
        const end = start + original.length;
        const total = slice.totalStepsLength || 0;
        const ordered = exchanges.slice().sort((a, b) => (a.afterOfficialStepIndex ?? -1) - (b.afterOfficialStepIndex ?? -1) || a.createdAt - b.createdAt);
        const insertedBefore = ordered.filter(exchange => (exchange.afterOfficialStepIndex ?? -1) < start - 1).reduce((n, exchange) => n + nativeExchangeStepCount(exchange), 0);
        const steps = [];
        let position = start + insertedBefore;
        const append = anchor => {
            for (const exchange of ordered.filter(item => (item.afterOfficialStepIndex ?? -1) === anchor)) {
                const added = makeNativeExchangeSteps(exchange, cid, position, cache);
                steps.push(...added); position += added.length;
            }
        };
        append(start - 1);
        original.forEach((item, i) => {
            let projected = item;
            if (item.step?.case === 'userInput') {
                const value = item.step.value;
                let clean = cache?.users?.get(item);
                if (!clean) {
                    clean = { ...item, step: { case: 'userInput', value: { ...value,
                        userResponse: stripBridgeMarkers(value.userResponse),
                        items: (value.items || []).map(chunk => chunk.chunk?.case === 'text' ? { ...chunk, chunk: { case: 'text', value: stripBridgeMarkers(chunk.chunk.value) } } : chunk)
                    } } };
                    cache?.users?.set(item, clean);
                }
                projected = clean;
            }
            steps.push(projected); position++;
            append(item.metadata?.sourceTrajectoryStepInfo?.stepIndex ?? start + i);
        });
        // Include a live exchange even when the transcript exporter is a little behind the UI.
        if (end === total) for (const exchange of ordered.filter(item => (item.afterOfficialStepIndex ?? -1) >= end)) {
            const added = makeNativeExchangeSteps(exchange, cid, position, cache); steps.push(...added); position += added.length;
        }
        const addedTotal = ordered.reduce((n, exchange) => n + nativeExchangeStepCount(exchange), 0);
        const running = exchanges.some(exchange => exchange.running);
        const indexed = steps.map((item, index) => {
            const info = item.metadata?.sourceTrajectoryStepInfo;
            const key = `${info?.trajectoryId}:${info?.stepIndex}`;
            const stepIndex = start + insertedBefore + index;
            const previous = cache?.indexed.get(key);
            if (previous?.source === item && previous.step.metadata.sourceTrajectoryStepInfo.stepIndex === stepIndex) return previous.step;
            const step = { ...item, __agyOfficialStepIndex: item.__agyRelay ? null : info?.stepIndex,
                metadata: { ...item.metadata, sourceTrajectoryStepInfo: { ...info, stepIndex } } };
            cache?.indexed.set(key, { source: item, step });
            return step;
        });
        return { ...base, __agyNativeProjection: true, status: running ? 2 : base.status, fullyIdle: running ? false : base.fullyIdle,
            trajectorySlice: { ...slice, stepsInSlice: indexed, totalStepsLength: total + addedTotal,
                stepsSlice: { ...slice.stepsSlice, startIndex: start + insertedBefore, endIndexExclusive: position }
            }
        };
    }

    function collectNativeExchanges(cid) {
        const persisted = state.bridge?.conversationId === cid ? state.bridge.exchanges || [] : nativeHistoryByConversation.get(cid) || [];
        const live = [...liveNativeTurns.values()].filter(exchange => exchange.conversationId === cid);
        return [...persisted.filter(exchange => !live.some(item => item.id === exchange.id)), ...live];
    }

    function retainNativePage(entry, value) {
        const slice = value?.trajectorySlice;
        if (!slice) return entry.base?.trajectorySlice ? { ...entry.base, ...value, trajectorySlice: entry.base.trajectorySlice } : value;
        const total = slice.totalStepsLength || 0;
        const previous = entry.base?.trajectorySlice;
        const trajectoryId = slice.trajectoryId || previous?.trajectoryId;
        const cache = entry.officialSteps;
        if (entry.officialTrajectoryId !== trajectoryId) {
            cache.clear(); entry.officialTrajectoryId = trajectoryId;
            entry.metadataPages = new Map();
            entry.lastHydration = null;
        }
        if ((previous?.totalStepsLength || 0) > total) entry.lastHydration = null;
        for (const index of cache.keys()) if (index >= total) cache.delete(index);
        const steps = slice.stepsInSlice || [];
        const offset = slice.stepsSlice?.startIndex || 0;
        const start = steps[0]?.metadata?.sourceTrajectoryStepInfo?.stepIndex ?? Math.max(0, Math.min(total, offset < 0 ? total + offset : offset));
        steps.forEach((step, index) => cache.set(step.metadata?.sourceTrajectoryStepInfo?.stepIndex ?? start + index, step));
        if (!total) { entry.metadataPages?.clear(); return value; }
        if (!cache.size) return value;
        // Preserve the previously displayed contiguous range while a narrower or
        // disjoint native page arrives. Pages are accumulated before publishing.
        const oldStart = previous?.stepsSlice?.startIndex ?? start;
        let first = cache.has(oldStart) ? oldStart : start;
        if (!cache.has(first)) first = Math.min(...cache.keys());
        let end = first + 1;
        while (first > 0 && cache.has(first - 1)) first--;
        while (end < total && cache.has(end)) end++;
        const combined = [];
        for (let index = first; index < end; index++) combined.push(cache.get(index));
        const retainedMetadata = {};
        for (const [itemsKey, boundsKey, totalKey] of [
            ['generatorMetadatasInSlice', 'generatorMetadataSlice', 'totalGeneratorMetadataLength'],
            ['executorMetadatasInSlice', 'executorMetadataSlice', 'totalExecutorMetadataLength']
        ]) {
            if (!Array.isArray(slice[itemsKey])) continue;
            const metadataTotal = slice[totalKey] || 0;
            const bounds = slice[boundsKey];
            const offset = bounds?.startIndex || 0;
            const metadataStart = Math.max(0, Math.min(metadataTotal, offset < 0 ? metadataTotal + offset : offset));
            const pages = entry.metadataPages || (entry.metadataPages = new Map());
            let page = pages.get(itemsKey);
            if (!page) { page = { items: new Map(), start: metadataStart }; pages.set(itemsKey, page); }
            for (const index of page.items.keys()) if (index >= metadataTotal) page.items.delete(index);
            slice[itemsKey].forEach((item, index) => page.items.set(metadataStart + index, item));
            let first = page.items.has(page.start) ? page.start : metadataStart;
            if (!page.items.has(first)) continue;
            let end = first + 1;
            while (first > 0 && page.items.has(first - 1)) first--;
            while (end < metadataTotal && page.items.has(end)) end++;
            const items = [];
            for (let index = first; index < end; index++) items.push(page.items.get(index));
            page.start = first;
            retainedMetadata[itemsKey] = items;
            retainedMetadata[boundsKey] = { ...bounds, startIndex: first, endIndexExclusive: end };
        }
        return { ...value, trajectorySlice: { ...slice, ...retainedMetadata, trajectoryId,
            stepsInSlice: combined, stepsSlice: { ...slice.stepsSlice, startIndex: first, endIndexExclusive: end } } };
    }

    function hydrateNativePages(entry, exchanges) {
        const slice = entry.base?.trajectorySlice;
        const total = slice?.totalStepsLength || 0;
        if (!exchanges.length || !total || entry.officialSteps.size >= total || entry.pageHydration) return;
        const key = `${slice.trajectoryId}:${total}`;
        if (entry.lastHydration === key || Date.now() < (entry.hydrationRetryAt || 0)) return;
        entry.lastHydration = key;
        // Native virtualization remains responsible for DOM rendering. Keep the
        // loaded official timeline complete so background page changes cannot hide relay turns.
        entry.pageHydration = Promise.resolve().then(() => {
            if (disposed || deletedConversations.has(entry.conversationId) || nativeOverlays.get(entry.provider) !== entry
                || getActiveConversationId() !== entry.conversationId || entry.officialTrajectoryId !== slice.trajectoryId) {
                if (entry.lastHydration === key) entry.lastHydration = null;
                return;
            }
            return entry.originalRequest({ startIndex: 0, endIndexExclusive: total });
        }).catch(() => {
            if (entry.lastHydration === key) { entry.lastHydration = null; entry.hydrationRetryAt = Date.now() + 5000; }
        }).finally(() => { entry.pageHydration = null; });
    }

    function acceptNativePage(entry, value) {
        if (value === entry.lastRaw) return entry.base;
        entry.lastRaw = value;
        const retained = retainNativePage(entry, value);
        const signature = JSON.stringify(retained, (_key, item) => {
            if (typeof item === 'bigint') return item.toString();
            if (item instanceof Map) return [...item];
            if (item instanceof Set) return [...item];
            return item;
        });
        if (signature === entry.baseSignature) return entry.base;
        entry.baseSignature = signature;
        return retained;
    }

    function publishNativeProjection(entry) {
        const exchanges = collectNativeExchanges(entry.conversationId);
        const signature = JSON.stringify(exchanges);
        if (entry.signature === signature && entry.projectedBase === entry.base && entry.provider.getState() === entry.projected) return;
        entry.signature = signature;
        entry.projectedBase = entry.base;
        entry.projected = projectNativeState(entry.base, exchanges, entry.conversationId, entry.stepCache);
        entry.originalSet(entry.projected);
        hydrateNativePages(entry, exchanges);
    }

    function syncNativeConversation() {
        const cid = getActiveConversationId();
        if (deletedConversations.has(cid)) return false;
        const inConversation = (window.location.pathname || '').startsWith('/c/');
        // A cached provider survives navigation. Do not let a newly mounted native
        // renderer consume projected indices before its action adapters are installed.
        for (const entry of nativeOverlays.values()) {
            if (inConversation && entry.conversationId === cid) continue;
            if (entry.provider.getState().__agyNativeProjection) entry.originalSet(entry.base);
            entry.signature = '';
            entry.projected = null;
        }
        if (!inConversation) return false;
        const context = nativeContext();
        const provider = context.states?.peek(cid);
        if (!provider?.setState || !provider.getState()?.trajectorySlice) return false;
        let entry = nativeOverlays.get(provider);
        if (!entry) {
            const underlying = context.states.getAgentStates().get(cid)?.underlyingProvider || provider;
            entry = { conversationId: cid, provider, underlying, base: underlying.getState(), originalSet: provider.setState, originalRequest: provider.requestPageUpdate, signature: '', officialSteps: new Map(), stepCache: { exchanges: new Map(), indexed: new Map(), users: new WeakMap() } };
            entry.base = acceptNativePage(entry, entry.base);
            // Merge before the native subscription emits to React, so relay
            // history never disappears between the raw and projected updates.
            provider.setState = value => {
                if (value?.__agyNativeProjection) return entry.originalSet(value);
                entry.base = acceptNativePage(entry, value);
                if (disposed || deletedConversations.has(cid) || !(location.pathname || '').startsWith('/c/') || getActiveConversationId() !== cid) {
                    entry.signature = '';
                    entry.projected = null;
                    return entry.originalSet(value);
                }
                publishNativeProjection(entry);
            };
            provider.requestPageUpdate = bounds => {
                const layout = nativeLayout(entry.base, collectNativeExchanges(cid), cid);
                if (!layout.total) return Promise.resolve();
                const startIndex = Math.min(layout.total - 1, layout.boundary(bounds.startIndex || 0));
                const endIndexExclusive = Math.max(startIndex + 1, bounds.endIndexExclusive === undefined ? layout.total : layout.boundary(bounds.endIndexExclusive));
                return entry.originalRequest({ ...bounds, startIndex, endIndexExclusive });
            };
            nativeOverlays.set(provider, entry);
        }
        const render = context.render;
        if (render?.chatParams && !render.chatParams.__agyAdapted) {
            const params = render.chatParams, previous = params.verboseAgentChat;
            params.verboseAgentChat = true;
            params.__agyAdapted = true;
            nativeAdapterCleanups.push(() => { params.verboseAgentChat = previous; delete params.__agyAdapted; });
        }
        if (render?.turnDiffsProvider && !render.turnDiffsProvider.__agyAdapted) {
            const diffs = render.turnDiffsProvider;
            const ensure = diffs.ensureFetched;
            const read = diffs.getState;
            let cachedRaw, cachedProjection, cachedResult;
            diffs.ensureFetched = (conversationId, trajectoryId, index) => {
                const active = [...nativeOverlays.values()].find(item => item.conversationId === conversationId && item.provider.getState().__agyNativeProjection);
                if (!active) return ensure(conversationId, trajectoryId, index);
                const item = (active.projected || active.provider.getState()).trajectorySlice.stepsInSlice.find(step => step.metadata?.sourceTrajectoryStepInfo?.stepIndex === index);
                if (item?.__agyRelay) return Promise.resolve(undefined);
                if (nativeLayout(active.base, collectNativeExchanges(conversationId), conversationId).officialAt(index) == null) return Promise.resolve(undefined);
                // Map once at the RPC boundary, including callbacks captured before injection.
                return ensure(conversationId, trajectoryId, index);
            };
            diffs.getState = () => {
                const raw = read(), active = nativeContext().states?.peek(getActiveConversationId());
                const projection = active?.getState();
                if (!projection?.__agyNativeProjection) return raw;
                if (raw === cachedRaw && projection === cachedProjection) return cachedResult;
                cachedRaw = raw; cachedProjection = projection; cachedResult = new Map(raw);
                for (const step of projection.trajectorySlice.stepsInSlice) {
                    if (step.__agyOfficialStepIndex == null) continue;
                    const info = step.metadata.sourceTrajectoryStepInfo;
                    const original = raw.get(`${projection.trajectorySlice.trajectoryId}:${step.__agyOfficialStepIndex}`);
                    if (original) cachedResult.set(`${projection.trajectorySlice.trajectoryId}:${info.stepIndex}`, original);
                }
                return cachedResult;
            };
            diffs.__agyAdapted = true;
            nativeAdapterCleanups.push(() => { diffs.ensureFetched = ensure; diffs.getState = read; delete diffs.__agyAdapted; });
        }
        if (render?.stepHandler && !render.stepHandler.__agyAdapted) {
            const handler = render.stepHandler;
            const preview = handler.getRevertPreviews, revert = handler.revertToIndex;
            const originalIndex = (index, conversationId) => {
                const steps = nativeContext().states?.peek(conversationId)?.getState().trajectorySlice?.stepsInSlice || [];
                return steps.filter(step => !step.__agyRelay && (step.metadata?.sourceTrajectoryStepInfo?.stepIndex ?? 0) <= index).at(-1)?.__agyOfficialStepIndex ?? -1;
            };
            handler.getRevertPreviews = (conversationId, index) => originalIndex(index, conversationId) < 0 ? Promise.resolve([]) : preview(conversationId, originalIndex(index, conversationId));
            handler.revertToIndex = async (conversationId, index, options) => {
                const active = nativeContext().states?.peek(conversationId);
                const projected = active?.getState().trajectorySlice?.stepsInSlice || [];
                const keep = (state.bridge.exchanges || []).filter(exchange => {
                    const steps = projected.filter(step => step.metadata?.sourceTrajectoryStepInfo?.trajectoryId === nativeTrajectoryId(exchange, conversationId));
                    return steps.length && steps.at(-1).metadata.sourceTrajectoryStepInfo.stepIndex <= index;
                }).map(exchange => exchange.id);
                const keepLive = [...liveNativeTurns.values()].filter(exchange => exchange.conversationId === conversationId && projected.filter(step => step.metadata?.sourceTrajectoryStepInfo?.trajectoryId === nativeTrajectoryId(exchange, conversationId)).at(-1)?.metadata.sourceTrajectoryStepInfo.stepIndex <= index).map(exchange => exchange.id);
                if ((nativeOverlays.get(active)?.base.trajectorySlice?.totalStepsLength || 0) > 0) {
                    const target = originalIndex(index, conversationId);
                    if (target < 0) throw new Error('当前版本无法原地回退到首条官方消息之前；原聊天记录已保留。请在新会话中重试这条消息。');
                    await revert(conversationId, target, options);
                }
                await apiFetch('/bridge/truncate', { method: 'POST', body: { conversationId, keepIds: keep } });
                for (const [key, exchange] of liveNativeTurns) {
                    if (exchange.conversationId === conversationId && !keepLive.includes(exchange.id)) liveNativeTurns.delete(key);
                }
                await refreshState();
            };
            handler.__agyAdapted = true;
            nativeAdapterCleanups.push(() => { handler.getRevertPreviews = preview; handler.revertToIndex = revert; delete handler.__agyAdapted; });
        }
        if (render?.sendMessage && !render.__agySendAdapted) {
            const send = render.sendMessage;
            render.sendMessage = async message => {
                if (state.activeMode !== 'custom') {
                    if (state.bridge?.conversationId === message.cascadeId && state.bridge.unsyncedCustomCount > 0) {
                        const consumed = await apiFetch('/bridge/consume', { method: 'POST', body: { conversationId: message.cascadeId, markAsSynced: false } });
                        if (consumed.bridgeBlock) message = { ...message, items: [...(message.items || []), { chunk: { case: 'text', value: consumed.bridgeBlock } }] };
                    }
                    return send(message);
                }
                const prompt = (message.items || []).filter(item => item.chunk?.case === 'text').map(item => item.chunk.value).join('\n');
                const editor = document.querySelector('[data-lexical-editor="true"]');
                await executeDirectCustomChat(prompt, editor);
            };
            render.__agySendAdapted = true;
            nativeAdapterCleanups.push(() => { render.sendMessage = send; delete render.__agySendAdapted; });
        }
        const exchanges = collectNativeExchanges(cid);
        publishNativeProjection(entry);
        if (exchanges.length) {
            document.querySelectorAll('.agy-ms-custom-turn-group, #agy-ms-startpage-chat-log').forEach(element => element.remove());
        }
        return true;
    }
    const nativeListenerCleanups = [];
    function bindNativeEvent(element, type, handler, capture = false) {
        element.addEventListener(type, handler, capture);
        nativeListenerCleanups.push(() => element.removeEventListener(type, handler, capture));
    }
    function bindNativeClick(element, handler, capture = false) {
        bindNativeEvent(element, 'click', handler, capture);
    }
    function showError(message, conversationId = getActiveConversationId()) {
        // A failed/deleted conversation must not leave an alert on a different
        // conversation when an asynchronous request finishes after navigation.
        if (conversationId !== getActiveConversationId()) return;
        let notice = document.getElementById('agy-ms-error-notice');
        if (!notice) {
            notice = document.createElement('div');
            notice.id = 'agy-ms-error-notice';
            notice.setAttribute('role', 'alert');
            notice.setAttribute(SKIP_I18N_ATTR, 'true');
            notice.style.cssText = 'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);z-index:100000;max-width:80vw;padding:12px 18px;border-radius:10px;background:#7f1d1d;color:white;cursor:pointer;';
            notice.addEventListener('click', () => notice.remove());
            document.body.appendChild(notice);
        }
        notice.setAttribute('data-agy-conversation-id', conversationId);
        notice.textContent = message;
    }

    function formatRunStatus(progress, now = Date.now()) {
        const contentIdle = Math.max(0, now - progress.lastContentAt);
        const elapsed = Math.floor(Math.max(0, now - progress.startedAt) / 1000);
        const monitor = progress.monitor;
        let phase = progress.phase;
        if (phase !== 'tool' && phase !== 'context' && contentIdle >= 10000) phase = 'waiting';
        let message;
        if (phase === 'tool') message = progress.message || '正在执行工具';
        else if (phase === 'context') message = '正在准备对话';
        else if (phase === 'thinking') message = `正在接收思考内容 · ${progress.thinkingLength || 0} 字`;
        else if (phase === 'streaming') message = `正在输出答复 · ${progress.replyLength || 0} 字`;
        else if (phase === 'receiving') message = '正在接收模型输出';
        else message = '等待模型响应';
        if (phase === 'waiting' || (phase === 'connecting' && elapsed >= 5)) {
            message = `等待模型响应 · ${Math.floor(contentIdle / 1000)} 秒没有新内容`;
            if (monitor) {
                const providerIdle = Math.max(0, monitor.providerIdleMs + now - monitor.receivedAt);
                if (monitor.providerSeen && providerIdle < 15000) message += ' · 上游连接仍有响应';
                else message += ` · 上游 ${Math.floor(providerIdle / 1000)} 秒无响应（${Math.max(0, Math.ceil((monitor.timeoutMs - providerIdle) / 1000))} 秒后超时）`;
            }
        }
        return { phase, text: `${message} · 已运行 ${elapsed} 秒` };
    }

    function syncRunStatus() {
        if (!activeRunStatus) return;
        const { cid, element } = activeRunStatus;
        if (cid !== getActiveConversationId() || !state.isSendingCustomChat || disposed) { element.remove(); return; }
        const composer = document.querySelector('[data-testid="agent-input-box"]');
        if (composer && element.parentElement !== composer) composer.prepend(element);
    }

    // 幂等清理旧实例（支持热重载注入）
    if (typeof window.__AGY_MODEL_SWITCHER_CLEANUP === 'function') {
        try {
            window.__AGY_MODEL_SWITCHER_CLEANUP();
        } catch (e) {
            console.warn('[ModelSwitcher] Cleanup error:', e);
        }
    }

    // 清理旧版本遗留的输入框快捷按钮、旧版下拉框底部区块与旧版侧边栏按钮闭包
    function removeLegacyElements() {
        const oldQuickBtn = document.getElementById('agy-custom-model-quick-btn');
        if (oldQuickBtn) oldQuickBtn.remove();
        const oldDropdownSection = document.getElementById('agy-ms-dropdown-custom-section');
        if (oldDropdownSection) oldDropdownSection.remove();
    }
    removeLegacyElements();
    const oldStyleEl = document.getElementById('agy-model-switcher-styles');
    if (oldStyleEl) oldStyleEl.remove();
    document.querySelectorAll('button[data-agy-custom-api-nav="1"]').forEach(el => el.remove());

    const state = {
        activeMode: 'official', // 'official' | 'custom'
        activeModelId: null,
        chatRelayMode: 'direct', // 'direct' | 'mcp'
        models: [],
        providers: [],
        localSessions: [],
        activeLocalSessionId: null,
        bridge: {
            conversationId: 'auto',
            officialTurnCount: 0,
            customExchangeCount: 0,
            unsyncedCustomCount: 0
        },
        cachedUnsyncedBlock: '',
        isSendingCustomChat: false,
        editingModelId: null
    };

    // 预设中转模型模板，方便用户一键填充
    const MODEL_PRESETS = [
        { label: 'Claude 3.7 Sonnet (中转)', modelId: 'claude-3-7-sonnet-20250219', protocol: 'auto' },
        { label: 'Claude 4.5 Sonnet (中转)', modelId: 'claude-sonnet-4-5-20250929', protocol: 'auto' },
        { label: 'Claude 4.6 Opus (中转)', modelId: 'claude-opus-4-6', protocol: 'auto' },
        { label: 'GPT-4o (中转)', modelId: 'gpt-4o', protocol: 'openai' },
        { label: 'DeepSeek V3', modelId: 'deepseek-chat', protocol: 'openai' },
        { label: 'DeepSeek R1', modelId: 'deepseek-reasoner', protocol: 'openai' }
    ];

    let startPageSessionId = `startpage-${crypto.randomUUID()}`;
    let lastKnownPathname = '';
    let isOpeningLocalSession = false;
    try {
        const stored = sessionStorage.getItem('agy-ms-local-session');
        if (/^(startpage-|local-)[a-zA-Z0-9_-]+$/.test(stored || '')) {
            state.activeLocalSessionId = stored;
            startPageSessionId = stored;
        }
    } catch {}

    function getActiveConversationId() {
        try {
            const pathname = window.location.pathname || '';
            if (pathname !== lastKnownPathname) {
                isOpeningLocalSession = false;
                lastKnownPathname = pathname;
            }
            const m = pathname.match(/\/c\/([a-f0-9-]{16,})/i);
            if (m && m[1]) return m[1];
        } catch {
            // ignore
        }
        return state.activeLocalSessionId || startPageSessionId;
    }

    function stripBridgeMarkers(text) {
        return String(text || '')
            .replace(/<!--\s*ANTIGRAVITY_BRIDGE_SYNC_START\s*-->[\s\S]*?<!--\s*ANTIGRAVITY_BRIDGE_SYNC_END\s*-->/gi, '')
            .trim();
    }

    function getActiveModelObj() {
        if (!state.models || state.models.length === 0) return null;
        return state.models.find(m => m.id === state.activeModelId) || state.models[0] || null;
    }

    async function apiFetch(subpath = '', options = {}) {
        const url = `${API_BASE}${subpath}`;
        const fetchOpts = {
            method: options.method || 'GET',
            headers: {
                'Content-Type': 'application/json',
                ...(options.headers || {})
            }
        };
        if (options.body) {
            fetchOpts.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
        }
        fetchOpts.signal = options.signal || AbortSignal.timeout(subpath === '/test' ? 25000 : 30000);
        const res = await fetch(url, fetchOpts);
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
        return data;
    }

    async function selectModel(mode, modelId, effort) {
        const sequence = ++selectionSequence;
        selectionPending = true;
        const operation = selectionQueue.then(() => apiFetch(effort === undefined ? '/select' : '/reasoning', {
            method: 'POST', body: effort === undefined ? { mode, modelId } : { modelId, effort, activate: true }
        }));
        selectionQueue = operation.catch(() => {});
        try {
            const data = await operation;
            if (!data.ok) throw new Error(data.error || '模型切换失败');
            if (disposed || sequence !== selectionSequence) return;
            state.activeMode = data.state.activeMode;
            state.activeModelId = data.state.activeModelId;
            if (Array.isArray(data.state.models)) state.models = data.state.models;
            syncAllUI();
        } catch (err) {
            if (!disposed && sequence === selectionSequence) showError(`模型切换失败：${err.message}`);
        } finally {
            if (sequence === selectionSequence) {
                selectionPending = false;
                await refreshState();
            }
        }
    }

    async function refreshState() {
        if (disposed || selectionPending) return;
        const sequence = ++refreshSequence;
        const selectionVersion = selectionSequence;
        try {
            const cid = getActiveConversationId();
            const data = await apiFetch(`?conversationId=${encodeURIComponent(cid)}`);
            if (disposed || selectionPending || selectionVersion !== selectionSequence || sequence !== refreshSequence || cid !== getActiveConversationId()) return;
            if (data && data.ok) {
                state.activeMode = data.activeMode || 'official';
                state.activeModelId = data.activeModelId || null;
                state.chatRelayMode = data.chatRelayMode || 'direct';
                state.models = Array.isArray(data.models) ? data.models : [];
                state.providers = Array.isArray(data.providers) ? data.providers : [];
                state.localSessions = Array.isArray(data.localSessions) ? data.localSessions : [];
                if (state.models.length === 0 && state.activeMode === 'custom') {
                    state.activeMode = 'official';
                    state.activeModelId = null;
                }
                if (data.bridge) {
                    state.bridge = data.bridge;
                    if (!data.bridge.deletedAt) nativeHistoryByConversation.set(data.bridge.conversationId, data.bridge.exchanges || []);
                    if (data.bridge.deletedAt) forgetNativeConversation(data.bridge.conversationId);
                }
                state.cachedUnsyncedBlock = '';
                syncAllUI();
            }
        } catch {
            // 守护进程尚未就绪时静默忽略
        }
    }

    // 注入全局样式（自适应明暗 / Claude 暖白主题）
    function ensureStyles() {
        let styleEl = document.getElementById('agy-model-switcher-styles');
        if (styleEl) return;
        styleEl = document.createElement('style');
        styleEl.id = 'agy-model-switcher-styles';
        styleEl.setAttribute(SKIP_I18N_ATTR, 'true');
        styleEl.textContent = `
            /* 当选中自定义模型时，隐藏触发按钮里的原生模型名，仅显示自定义模型名与右侧箭头 */
            button[data-testid="model-selector-trigger"].agy-ms-custom-trigger-active > *:not(.agy-ms-trigger-custom-label):not(svg) {
                display: none !important;
            }
            /* 当选中自定义模型时，隐藏原生模型菜单项右侧的默认勾选图标 */
            div[data-testid="model-selector-panel"].agy-ms-panel-custom-active div[role="menuitem"]:not([data-agy-custom-item="true"]) > span.ml-auto {
                display: none !important;
            }
            /* Modal 弹窗样式 - 完美适配 Claude 暖色浅色主题与深色主题 */
            .agy-ms-modal-backdrop {
                position: fixed;
                inset: 0;
                z-index: 99999;
                background: rgba(20, 19, 17, 0.45);
                backdrop-filter: blur(3px);
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 16px;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Microsoft YaHei", sans-serif;
            }
            .agy-ms-modal {
                width: 660px;
                max-width: 96vw;
                max-height: 88vh;
                display: flex;
                flex-direction: column;
                border-radius: 14px;
                background: var(--background, #faf9f5);
                color: var(--foreground, #1f1e1b);
                border: 1px solid var(--border, rgba(31, 30, 27, 0.14));
                box-shadow: 0 20px 50px rgba(0, 0, 0, 0.22);
                overflow: hidden;
            }
            .agy-ms-modal-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 14px 18px;
                border-bottom: 1px solid var(--border, rgba(31, 30, 27, 0.1));
                background: var(--secondary, rgba(0, 0, 0, 0.03));
            }
            .agy-ms-modal-title {
                font-size: 15px;
                font-weight: 600;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .agy-ms-modal-close {
                background: transparent;
                border: none;
                color: var(--muted-foreground, #6b665e);
                font-size: 16px;
                cursor: pointer;
                padding: 4px 8px;
                border-radius: 6px;
            }
            .agy-ms-modal-close:hover {
                background: var(--secondary, rgba(0, 0, 0, 0.08));
                color: var(--foreground, #1f1e1b);
            }
            .agy-ms-modal-body {
                padding: 16px 18px;
                overflow-y: auto;
                display: flex;
                flex-direction: column;
                gap: 14px;
            }
            .agy-ms-form-card {
                background: var(--card, rgba(255, 255, 255, 0.65));
                border: 1px solid var(--border, rgba(31, 30, 27, 0.12));
                border-radius: 10px;
                padding: 14px;
                display: flex;
                flex-direction: column;
                gap: 10px;
            }
            .agy-ms-grid-2 {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 10px;
            }
            .agy-ms-field {
                display: flex;
                flex-direction: column;
                gap: 4px;
            }
            .agy-ms-field label {
                font-size: 12px;
                color: var(--foreground, #1f1e1b);
                opacity: 0.85;
                font-weight: 500;
            }
            .agy-ms-input, .agy-ms-select {
                background: var(--background, #ffffff);
                border: 1px solid var(--border, rgba(31, 30, 27, 0.2));
                color: var(--foreground, #1f1e1b);
                border-radius: 7px;
                padding: 7px 10px;
                font-size: 12.5px;
                outline: none;
                width: 100%;
                box-sizing: border-box;
                transition: border-color 0.15s;
            }
            .agy-ms-input:focus, .agy-ms-select:focus {
                border-color: #c96442;
                box-shadow: 0 0 0 2px rgba(201, 100, 66, 0.16);
            }
            .agy-ms-presets {
                display: flex;
                flex-wrap: wrap;
                gap: 5px;
                align-items: center;
            }
            .agy-ms-preset-chip {
                font-size: 11px;
                padding: 2px 8px;
                border-radius: 999px;
                background: var(--secondary, rgba(0, 0, 0, 0.06));
                border: 1px solid var(--border, rgba(0, 0, 0, 0.12));
                color: var(--foreground, #1f1e1b);
                cursor: pointer;
                transition: all 0.12s;
            }
            .agy-ms-preset-chip:hover {
                border-color: #c96442;
                color: #c96442;
            }
            .agy-ms-btn-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
                margin-top: 4px;
                flex-wrap: wrap;
            }
            .agy-ms-btn {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 5px;
                padding: 6px 12px;
                border-radius: 7px;
                font-size: 12.5px;
                font-weight: 500;
                cursor: pointer;
                border: 1px solid var(--border, rgba(0, 0, 0, 0.15));
                background: var(--secondary, rgba(0, 0, 0, 0.05));
                color: var(--foreground, #1f1e1b);
                transition: all 0.15s;
            }
            .agy-ms-btn:hover:not(:disabled) {
                background: rgba(0, 0, 0, 0.09);
            }
            .agy-ms-btn:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
            .agy-ms-btn.primary {
                background: #c96442;
                border-color: #b85737;
                color: #ffffff;
            }
            .agy-ms-btn.primary:hover:not(:disabled) {
                background: #b55434;
            }
            .agy-ms-btn.success {
                background: rgba(16, 185, 129, 0.14);
                border-color: rgba(16, 185, 129, 0.4);
                color: #059669;
            }
            .agy-ms-btn.success:hover:not(:disabled) {
                background: rgba(16, 185, 129, 0.22);
            }
            .agy-ms-btn.danger {
                background: rgba(239, 68, 68, 0.12);
                border-color: rgba(239, 68, 68, 0.35);
                color: #dc2626;
            }
            .agy-ms-btn.danger:hover:not(:disabled) {
                background: rgba(239, 68, 68, 0.2);
            }
            .agy-ms-tag {
                font-size: 10.5px;
                padding: 1px 6px;
                border-radius: 999px;
                background: var(--secondary, rgba(0, 0, 0, 0.07));
                color: var(--muted-foreground, #6b665e);
                white-space: nowrap;
            }
            .agy-ms-tag.ok {
                background: rgba(16, 185, 129, 0.15);
                color: #059669;
            }
            .agy-ms-test-banner {
                padding: 9px 12px;
                border-radius: 8px;
                font-size: 12px;
                line-height: 1.45;
                display: none;
                word-break: break-word;
            }
            .agy-ms-test-banner.ok {
                display: block;
                background: rgba(16, 185, 129, 0.12);
                border: 1px solid rgba(16, 185, 129, 0.35);
                color: #047857;
            }
            .agy-ms-test-banner.err {
                display: block;
                background: rgba(239, 68, 68, 0.12);
                border: 1px solid rgba(239, 68, 68, 0.35);
                color: #b91c1c;
            }
            .agy-ms-test-banner.loading {
                display: block;
                background: rgba(59, 130, 246, 0.12);
                border: 1px solid rgba(59, 130, 246, 0.35);
                color: #1d4ed8;
            }
            .agy-ms-model-list {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            .agy-ms-model-card {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                padding: 10px 12px;
                border-radius: 8px;
                background: var(--card, rgba(255, 255, 255, 0.55));
                border: 1px solid var(--border, rgba(0, 0, 0, 0.1));
            }
            .agy-ms-model-card.active {
                border-color: rgba(16, 185, 129, 0.55);
                background: rgba(16, 185, 129, 0.06);
            }
            /* 聊天流中的无缝中转模型消息气泡 */
            .agy-ms-chat-turn {
                display: flex;
                flex-direction: column;
                gap: 8px;
                margin: 8px 0;
                padding: 12px 14px;
                border-radius: 10px;
                border: 1px solid var(--border, rgba(0, 0, 0, 0.14));
                background: var(--card, rgba(255, 255, 255, 0.5));
                font-size: 13.5px;
                line-height: 1.6;
            }
            .agy-ms-chat-turn-user {
                align-self: flex-end;
                max-width: 85%;
                padding: 8px 12px;
                border-radius: 10px;
                background: var(--secondary, rgba(128, 128, 128, 0.14));
                font-size: 13.5px;
                white-space: pre-wrap;
                word-break: break-word;
            }
            .agy-ms-chat-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                font-size: 11.5px;
                opacity: 0.78;
                border-bottom: 1px solid var(--border, rgba(128, 128, 128, 0.15));
                padding-bottom: 6px;
            }
            .agy-ms-chat-body {
                white-space: normal;
                word-break: break-word;
                user-select: text;
                line-height: 1.65;
            }
            .agy-ms-chat-body p {
                margin: 4px 0;
            }
            .agy-ms-chat-body p:first-child {
                margin-top: 0;
            }
            .agy-ms-chat-body p:last-child {
                margin-bottom: 0;
            }
            .agy-ms-chat-body blockquote {
                border-left: 3px solid var(--border, rgba(128, 128, 128, 0.35));
                padding-left: 10px;
                margin: 6px 0;
                opacity: 0.9;
            }
            .agy-ms-chat-body ul {
                list-style-type: disc;
                padding-left: 20px;
                margin: 6px 0;
            }
            .agy-ms-chat-body ol {
                list-style-type: decimal;
                padding-left: 20px;
                margin: 6px 0;
            }
            .agy-ms-chat-body li {
                margin: 2px 0;
            }
            .agy-ms-chat-body pre {
                background: rgba(0, 0, 0, 0.06);
                padding: 10px 12px;
                border-radius: 6px;
                overflow-x: auto;
                font-family: Consolas, Monaco, monospace;
                font-size: 12.5px;
                margin: 6px 0;
                white-space: pre;
            }
            /* 消除原生轮次 100cqh 最小高度造成的底部大空白，让中转 API 回复紧贴上一条消息继续显示 */
            div.relative.flex.flex-col.gap-y-3:has(.agy-ms-custom-turn-group) > div.flex.items-start,
            div.flex.items-start:has(.agy-ms-custom-turn-group) {
                min-height: 0 !important;
            }
            @keyframes agy-ms-spin {
                to { transform: rotate(360deg); }
            }
            @keyframes agy-ms-blink {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.15; }
            }
            .agy-ms-spinner {
                display: inline-block;
                width: 12px;
                height: 12px;
                border: 2px solid currentColor;
                border-top-color: transparent;
                border-radius: 9999px;
                animation: agy-ms-spin 0.75s linear infinite;
                flex-shrink: 0;
            }
            .agy-ms-live-status {
                display: inline-flex;
                align-items: center;
                gap: 7px;
                font-size: 12px;
                padding: 4px 10px;
                border-radius: 8px;
                background: rgba(217, 119, 87, 0.08);
                border: 1px solid rgba(217, 119, 87, 0.24);
                color: var(--foreground, #1f1e1d);
                margin-bottom: 6px;
                width: fit-content;
                max-width: 100%;
            }
            .agy-ms-thinking-box {
                margin-bottom: 8px;
                font-size: 12.5px;
                border-radius: 8px;
                background: rgba(128, 128, 128, 0.06);
                border: 1px solid var(--border, rgba(128, 128, 128, 0.18));
                padding: 6px 10px;
            }
            .agy-ms-thinking-box summary {
                cursor: pointer;
                font-weight: 500;
                opacity: 0.85;
                user-select: none;
            }
            .agy-ms-thinking-content {
                padding: 6px 8px 2px 8px;
                margin-top: 4px;
                border-left: 2px solid rgba(217, 119, 87, 0.45);
                white-space: pre-wrap;
                opacity: 0.85;
                max-height: 280px;
                overflow-y: auto;
                line-height: 1.55;
            }
            .agy-ms-stream-cursor {
                display: inline-block;
                margin-left: 2px;
                color: #d97757;
                font-weight: bold;
                animation: agy-ms-blink 0.9s step-end infinite;
            }
            .agy-ms-tool-steps {
                display: flex;
                flex-direction: column;
                gap: 6px;
                margin: 4px 0 8px 0;
            }
            .agy-ms-tool-card {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                padding: 5px 10px;
                border-radius: 8px;
                background: var(--secondary, rgba(128, 128, 128, 0.08));
                border: 1px solid var(--border, rgba(128, 128, 128, 0.18));
                font-size: 12px;
                line-height: 1.4;
            }
            .agy-ms-tool-card-left {
                display: flex;
                align-items: center;
                gap: 7px;
                min-width: 0;
                flex: 1;
            }
            .agy-ms-tool-card-detail {
                font-family: Consolas, Monaco, monospace;
                font-size: 11.5px;
                opacity: 0.78;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .agy-ms-tool-card-right {
                font-size: 11px;
                opacity: 0.75;
                white-space: nowrap;
                flex-shrink: 0;
            }
            .agy-ms-local-sessions-box {
                display: flex;
                flex-direction: column;
                gap: 2px;
                margin-top: 2px;
                padding-left: 6px;
                border-left: 2px solid rgba(217, 119, 87, 0.35);
            }
            .agy-ms-local-session-item {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 4px;
                height: 28px;
                padding: 0 8px;
                border-radius: 6px;
                font-size: 12px;
                color: var(--secondary-foreground, #6b665e);
                cursor: pointer;
                user-select: none;
                transition: background-color 0.15s, color 0.15s;
            }
            .agy-ms-local-session-item:hover,
            .agy-ms-local-session-item.active {
                background: var(--sidebar-muted, rgba(128, 128, 128, 0.12));
                color: var(--foreground, #1f1e1d);
            }
        `;
        document.head.appendChild(styleEl);
    }

    /**
     * 打开指定的纯中转 API 独立会话（如 startpage-*）
     */
    async function openLocalCustomSession(sessionId) {
        if (!sessionId) return;
        const session = state.localSessions.find(item => item.conversationId === sessionId);
        const created = await createNativeConversation(session?.title || '新会话', sessionId);
        if (created) {
            await created.context.router.navigate({ to: '/c/$cascadeId', params: { cascadeId: created.cid }, search: { section: 'outside-of-project' } });
            await refreshState();
            return;
        }
        state.activeLocalSessionId = sessionId;
        startPageSessionId = sessionId;
        try { sessionStorage.setItem('agy-ms-local-session', sessionId); } catch {}
        const oldLog = document.getElementById('agy-ms-startpage-chat-log');
        if (oldLog) {
            oldLog.innerHTML = '';
        }
        if ((window.location.pathname || '').startsWith('/c/')) {
            const newChatBtn = document.querySelector('a[data-testid="new-conversation-button"], a[href="/"]');
            if (newChatBtn) {
                isOpeningLocalSession = true;
                newChatBtn.click();
            }
        }
        await refreshState();
    }

    /**
     * 在左侧边栏【个性化定制】(`a[href="/customizations"]`) 的正下方注入【接入中转 API】入口按钮及纯 API 会话列表
     */
    function injectSidebarNavEntry() {
        ensureStyles();

        // 监听原生【新建会话】按钮点击，确保点击新建会话时清空当前 startpage 聊天流并创建全新会话 ID
        document.querySelectorAll('a[data-testid="new-conversation-button"], a[href="/"]').forEach((newBtn) => {
            if (newBtn.getAttribute('data-agy-bound-newchat') === '1') return;
            newBtn.setAttribute('data-agy-bound-newchat', '1');
            bindNativeClick(newBtn, () => {
                if (isOpeningLocalSession) return;
                state.activeLocalSessionId = null;
                try { sessionStorage.removeItem('agy-ms-local-session'); } catch {}
                startPageSessionId = `startpage-${crypto.randomUUID()}`;
                const oldLog = document.getElementById('agy-ms-startpage-chat-log');
                if (oldLog) oldLog.remove();
                document.querySelectorAll('.agy-claude-hero-greeting, .agy-claude-starter-pills').forEach(el => {
                    el.style.display = '';
                });
                setTimeout(refreshState, 50);
            });
        });

        const customizationsLinks = document.querySelectorAll('a[href="/customizations"]');
        customizationsLinks.forEach((linkEl) => {
            const parent = linkEl.parentElement;
            if (!parent) return;

            let navBtn = parent.querySelector('button[data-agy-custom-api-nav="1"]');
            if (!navBtn) {
                navBtn = document.createElement('button');
                navBtn.type = 'button';
                navBtn.id = 'agy-sidebar-custom-api-btn';
                navBtn.setAttribute('data-testid', 'custom-api-models-button');
                navBtn.setAttribute('data-agy-custom-api-nav', '1');
                navBtn.setAttribute(SKIP_I18N_ATTR, 'true');
                navBtn.className = 'inline-flex items-center font-medium transition-colors select-none outline-none cursor-pointer disabled:opacity-50 flex-grow w-full justify-start select-none font-normal h-8 min-w-0 gap-1.5 px-2 py-1 rounded-lg bg-transparent text-secondary-foreground hover:bg-sidebar-muted hover:text-foreground';
                navBtn.innerHTML = `
                    <span class="shrink-0 flex items-center">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 -960 960 960" fill="currentColor">
                            <path d="M280-400q-33 0-56.5-23.5T200-480q0-33 23.5-56.5T280-560q33 0 56.5 23.5T360-480q0 33-23.5 56.5T280-400Zm0 160q-100 0-170-70T40-480q0-100 70-170t170-70q67 0 121.5 33t86.5 87h352l120 120-180 180-80-60-80 60-85-60h-47q-32 54-86.5 87T280-240Zm0-60q56 0 98.5-34t56.5-86h125l58 41 82-61 71 55 75-75-40-40H435q-14-52-56.5-86T280-660q-75 0-127.5 52.5T100-480q0 75 52.5 127.5T280-300Z"></path>
                        </svg>
                    </span>
                    <span class="truncate text-sm">接入中转 API</span>
                `;
                navBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openModelManagerModal();
                });
                linkEl.insertAdjacentElement('afterend', navBtn);
            }

            // 在【接入中转 API】下方渲染纯 API 独立会话列表（解决新建纯 API 会话在切换对话后无法找回的问题）
            let localBox = parent.querySelector('div[data-agy-local-sessions="1"]');
            const sessions = Array.isArray(state.localSessions) ? state.localSessions : [];
            if (sessions.length === 0) {
                if (localBox) localBox.remove();
                return;
            }
            if (!localBox) {
                localBox = document.createElement('div');
                localBox.setAttribute('data-agy-local-sessions', '1');
                localBox.setAttribute(SKIP_I18N_ATTR, 'true');
                localBox.className = 'agy-ms-local-sessions-box';
                const historyLink = document.querySelector('a[href^="/c/"]');
                (historyLink?.parentElement || parent).appendChild(localBox);
            }
            const activeCid = getActiveConversationId();
            const sig = JSON.stringify({ activeCid, sessions: sessions.map(s => ({ id: s.conversationId, t: s.title, c: s.exchangeCount })) });
            if (localBox.getAttribute('data-sig') !== sig) {
                localBox.setAttribute('data-sig', sig);
                localBox.innerHTML = '';
                sessions.slice(0, 8).forEach((sess) => {
                    const item = document.createElement('div');
                    item.className = `agy-ms-local-session-item ${activeCid === sess.conversationId ? 'active' : ''}`;
                    item.title = `API 会话: ${sess.title} (${sess.lastModelName || 'API'})`;
                    item.innerHTML = `
                        <span class="truncate flex-1">${escapeHtml(sess.title)}</span>
                        <span class="agy-ms-del-session opacity-60 hover:opacity-100 px-1 text-xs" title="删除此 API 会话">×</span>
                    `;
                    item.addEventListener('click', (ev) => {
                        ev.preventDefault();
                        ev.stopPropagation();
                        openLocalCustomSession(sess.conversationId);
                    });
                    const delBtn = item.querySelector('.agy-ms-del-session');
                    if (delBtn) {
                        delBtn.addEventListener('click', async (ev) => {
                            ev.preventDefault();
                            ev.stopPropagation();
                            await apiFetch('/bridge/clear', {
                                method: 'POST',
                                body: { conversationId: sess.conversationId }
                            });
                            if (state.activeLocalSessionId === sess.conversationId) {
                                state.activeLocalSessionId = null;
                                const oldLog = document.getElementById('agy-ms-startpage-chat-log');
                                if (oldLog) oldLog.remove();
                            }
                            await refreshState();
                        });
                    }
                    localBox.appendChild(item);
                });
            }
        });
    }

    /**
     * 更新聊天输入框左下角的模型选择触发按钮显示名称（不挂载任何额外快捷按钮，也不修改原生文本节点）
     */
    function syncComposerFooterUI() {
        ensureStyles();
        removeLegacyElements();

        const triggerBtn = document.querySelector('button[data-testid="model-selector-trigger"]');
        if (!triggerBtn) return;

        const activeCustom = getActiveModelObj();
        let customLabelEl = triggerBtn.querySelector('.agy-ms-trigger-custom-label');

        if (state.activeMode === 'custom' && activeCustom) {
            triggerBtn.classList.add('agy-ms-custom-trigger-active');
            Array.from(triggerBtn.children).forEach((child) => {
                if (child.tagName === 'SPAN' && !child.classList.contains('agy-ms-trigger-custom-label')) {
                    if (child.style.display !== 'none') child.style.display = 'none';
                }
            });
            if (!customLabelEl) {
                customLabelEl = document.createElement('span');
                customLabelEl.className = 'agy-ms-trigger-custom-label flex items-center gap-1.5 min-w-0 truncate';
                customLabelEl.setAttribute(SKIP_I18N_ATTR, 'true');
                triggerBtn.insertBefore(customLabelEl, triggerBtn.firstChild);
            }
            const effortLabel = activeCustom.reasoningOptions?.find(option => option.value === (activeCustom.reasoningEffort || 'default'))?.label;
            const labelSig = `${activeCustom.name}:${effortLabel || ''}`;
            const desiredHtml = `<span class="truncate text-xs">${escapeHtml(activeCustom.name)}</span>${effortLabel ? `<span class="shrink-0 opacity-70 text-xs">${escapeHtml(effortLabel)}</span>` : ''}`;
            if (customLabelEl.getAttribute('data-agy-label-sig') !== labelSig) {
                customLabelEl.setAttribute('data-agy-label-sig', labelSig);
                customLabelEl.innerHTML = desiredHtml;
            }
        } else {
            triggerBtn.classList.remove('agy-ms-custom-trigger-active');
            if (customLabelEl) {
                customLabelEl.remove();
            }
            Array.from(triggerBtn.children).forEach((child) => {
                if (child.tagName === 'SPAN' && child.style.display === 'none') {
                    child.style.display = '';
                }
            });
        }
    }

    function closeReasoningMenu(panel) {
        panel.parentElement?.querySelectorAll('.agy-ms-effort-submenu').forEach(menu => menu.remove());
        panel.querySelectorAll('[data-agy-custom-item][aria-expanded="true"]').forEach(row => row.setAttribute('aria-expanded', 'false'));
    }

    function closeRelayModelMenu(panel) {
        closeReasoningMenu(panel);
        const escape = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true });
        panel.dispatchEvent(escape);
        document.dispatchEvent(escape);
    }

    function openReasoningMenu(panel, item, model, focus = false) {
        const options = model.reasoningOptions || [];
        if (!options.length) return;
        const popup = panel.parentElement;
        const previous = popup.querySelector('.agy-ms-effort-submenu');
        if (previous?.getAttribute('data-agy-model-id') === model.id) {
            if (focus) previous.querySelector('[role="menuitemradio"]')?.focus();
            return;
        }
        closeReasoningMenu(panel);
        item.setAttribute('aria-expanded', 'true');
        const menu = document.createElement('div');
        menu.className = 'agy-ms-effort-submenu bg-card text-foreground rounded-[10px] border border-border shadow-md p-1 flex flex-col gap-px';
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', `${model.name} 思考强度`);
        menu.setAttribute('data-agy-model-id', model.id);
        menu.setAttribute(SKIP_I18N_ATTR, 'true');
        const bounds = popup.getBoundingClientRect(), row = item.getBoundingClientRect();
        popup.style.position = 'relative';
        Object.assign(menu.style, { position: 'absolute', zIndex: '100', minWidth: '140px', maxHeight: 'min(320px, 80vh)', overflowY: 'auto',
            top: `${Math.max(0, Math.min(row.top - bounds.top, window.innerHeight - bounds.top - (options.length * 30 + 36)))}px`,
            ...(bounds.right + 148 < window.innerWidth ? { left: 'calc(100% + 4px)' } : { right: 'calc(100% + 4px)' }) });
        const heading = document.createElement('div');
        heading.className = 'px-2 py-1 text-xs text-muted-foreground';
        heading.textContent = '思考强度';
        menu.appendChild(heading);
        const close = () => closeReasoningMenu(panel);
        for (const option of options) {
            const choice = document.createElement('div');
            choice.setAttribute('role', 'menuitemradio');
            choice.setAttribute('tabindex', '-1');
            choice.setAttribute('data-agy-effort', option.value);
            const checked = (model.reasoningEffort || 'default') === option.value;
            choice.setAttribute('aria-checked', String(checked));
            choice.className = `${item.className} justify-between`;
            choice.innerHTML = `<span class="text-xs">${escapeHtml(option.label)}</span>${checked ? '<span aria-hidden="true">✓</span>' : ''}`;
            choice.addEventListener('pointerdown', event => event.stopPropagation());
            choice.addEventListener('click', async event => {
                event.preventDefault(); event.stopPropagation();
                closeRelayModelMenu(panel);
                await selectModel('custom', model.id, option.value);
            });
            menu.appendChild(choice);
        }
        menu.addEventListener('keydown', event => {
            const choices = [...menu.querySelectorAll('[role="menuitemradio"]')];
            let index = choices.indexOf(document.activeElement);
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault(); event.stopPropagation();
                index = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length;
                choices[index]?.focus();
            } else if (['Enter', ' '].includes(event.key)) {
                event.preventDefault(); event.stopPropagation(); choices[index]?.click();
            } else if (['Escape', 'ArrowLeft'].includes(event.key)) {
                event.preventDefault(); event.stopPropagation(); close(); item.focus();
            }
        });
        popup.appendChild(menu);
        if (focus) menu.querySelector('[role="menuitemradio"][aria-checked="true"]')?.focus();
    }

    /**
     * 当原生模型选择面板 (`div[data-testid="model-selector-panel"]`) 打开时：
     * - 不显示任何“添加/管理中转模型”按钮或空状态提示；
     * - 仅当用户已添加自定义模型 (`state.models.length > 0`) 时，将自定义模型直接作为原生菜单项 (`div[role="menuitem"]`) 渲染在模型列表中。
     */
    function injectIntoNativeModelSelectorPanel() {
        const panel = document.querySelector('div[data-testid="model-selector-panel"]');
        if (!panel) return;
        if (!modelPanelBindings.has(panel)) {
            const onRowEntered = event => {
                const row = event.target instanceof Element ? event.target.closest('[role="menuitem"], [role="menuitemradio"]') : null;
                if (!row || !panel.contains(row)) return;
                const menu = panel.parentElement?.querySelector('.agy-ms-effort-submenu');
                if (menu && row.getAttribute('data-agy-model-id') !== menu.getAttribute('data-agy-model-id')) closeReasoningMenu(panel);
            };
            bindNativeEvent(panel, 'pointerover', onRowEntered);
            bindNativeEvent(panel, 'focusin', onRowEntered);
            modelPanelBindings.add(panel);
        }

        // 移除任何旧版遗留的底部管理区块
        const oldSection = panel.querySelector('#agy-ms-dropdown-custom-section');
        if (oldSection) oldSection.remove();

        const headerEl = panel.querySelector('div[data-testid="model-selector-header"]');
        const listContainer = (headerEl && headerEl.nextElementSibling) || panel.querySelector('div.flex.flex-col.gap-px');
        if (!listContainer) return;

        const isCustomActive = state.activeMode === 'custom' && Boolean(getActiveModelObj());
        panel.classList.toggle('agy-ms-panel-custom-active', isCustomActive);

        // 给模型列表中的原生官方模型项绑定点击事件：点击任何官方模型时自动切回 official 模式
        const nativeItems = listContainer.querySelectorAll('div[role="menuitem"]:not([data-agy-custom-item="true"])');
        nativeItems.forEach((item) => {
            if (item.getAttribute('data-agy-bound-official') === '1') return;
            item.setAttribute('data-agy-bound-official', '1');
            bindNativeClick(item, async () => {
                closeReasoningMenu(panel);
                if (state.activeMode !== 'official') {
                    await selectModel('official');
                }
            }, true);
        });

        const sig = JSON.stringify({
            mode: state.activeMode,
            activeId: state.activeModelId,
            models: state.models.map(m => ({
                id: m.id,
                name: m.name,
                modelId: m.modelId,
                reasoningEffort: m.reasoningEffort, reasoningOptions: m.reasoningOptions
            }))
        });

        if (listContainer.getAttribute('data-agy-custom-sig') === sig) {
            return;
        }
        listContainer.setAttribute('data-agy-custom-sig', sig);
        closeReasoningMenu(panel);

        // 清理已有的自定义模型菜单项并重新渲染
        listContainer.querySelectorAll('div[data-agy-custom-item="true"]').forEach(el => el.remove());

        if (!state.models || state.models.length === 0) {
            return;
        }

        for (const m of state.models) {
            const isSelected = state.activeMode === 'custom' && state.activeModelId === m.id;
            const item = document.createElement('div');
            item.setAttribute('role', 'menuitem');
            item.setAttribute('tabindex', '-1');
            item.setAttribute('data-testid', 'model-selector-item');
            item.setAttribute('data-agy-custom-item', 'true');
            item.setAttribute('data-agy-model-id', m.id);
            item.setAttribute(SKIP_I18N_ATTR, 'true');
            const effortOptions = m.reasoningOptions || [];
            const effortLabel = effortOptions.find(option => option.value === (m.reasoningEffort || 'default'))?.label;
            if (effortOptions.length) { item.setAttribute('aria-haspopup', 'menu'); item.setAttribute('aria-expanded', 'false'); }
            item.className = `group w-full pr-2 pl-2 text-left text-[13px] cursor-pointer outline-none no-focus-ring transition-colors select-none flex items-center rounded-md py-1 gap-1.5 hover:bg-secondary hover:text-foreground focus:bg-secondary focus:text-foreground ${isSelected ? 'text-foreground' : 'text-secondary-foreground'} justify-between`;

            item.innerHTML = `
                <span class="flex items-center gap-1.5 min-w-0 flex-1 truncate">
                    <span class="truncate text-xs text-left">${escapeHtml(m.name)}</span>
                    ${effortLabel ? `<span class="shrink-0 opacity-70 text-xs">${escapeHtml(effortLabel)}</span>` : ''}
                </span>
                ${isSelected ? `<span class="ml-auto flex shrink-0 pl-2"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 -960 960 960" fill="currentColor"><path d="M382-253.85L168.62-467.23L211.38-510L382-339.38L748.62-706l42.77,42.77L382-253.85Z"></path></svg></span>` : ''}
                ${effortOptions.length ? '<span class="shrink-0 opacity-50" aria-hidden="true">›</span>' : ''}
            `;

            item.addEventListener('pointerdown', (e) => {
                if (e.button === 0) {
                    e.stopPropagation();
                }
            }, true);

            if (effortOptions.length) {
                item.addEventListener('pointerenter', () => openReasoningMenu(panel, item, m));
                item.addEventListener('keydown', event => {
                    if (['ArrowRight', 'Enter', ' '].includes(event.key)) {
                        event.preventDefault(); event.stopPropagation(); openReasoningMenu(panel, item, m, true);
                    }
                });
            }

            item.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();

                if (effortOptions.length) { openReasoningMenu(panel, item, m, true); return; }

                // 关闭原生 Base-UI 模型选择下拉框
                const escEvent = new KeyboardEvent('keydown', {
                    key: 'Escape',
                    code: 'Escape',
                    keyCode: 27,
                    bubbles: true,
                    cancelable: true
                });
                panel.dispatchEvent(escEvent);
                document.dispatchEvent(escEvent);

                await selectModel('custom', m.id);
            }, true);

            listContainer.appendChild(item);
        }
    }

    function escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /**
     * 打开自定义中转模型配置与连接测试弹窗（从左侧边栏【个性化定制】下方的【接入中转 API】进入）
     */
    function openModelManagerModal(editModel = null) {
        ensureStyles();
        let existing = document.getElementById('agy-model-manager-backdrop');
        if (existing) existing.remove();

        state.editingModelId = editModel ? editModel.id : null;

        const backdrop = document.createElement('div');
        backdrop.id = 'agy-model-manager-backdrop';
        backdrop.className = 'agy-ms-modal-backdrop';
        backdrop.setAttribute(SKIP_I18N_ATTR, 'true');

        const modal = document.createElement('div');
        modal.className = 'agy-ms-modal';
        modal.addEventListener('click', e => e.stopPropagation());

        modal.innerHTML = `
            <div class="agy-ms-modal-header">
                <div class="agy-ms-modal-title">
                    <span>🔌 接入中转 API / 自定义模型管理</span>
                    <span class="agy-ms-tag ok">同会话无缝切换已启用</span>
                </div>
                <button type="button" class="agy-ms-modal-close" id="agy-ms-close-btn">✕</button>
            </div>
            <div class="agy-ms-modal-body">
                <!-- 新增 / 编辑模型表单 -->
                <div class="agy-ms-form-card">
                    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;">
                        <span style="font-size:13px;font-weight:600;" id="agy-ms-form-heading">
                            ${editModel ? `✏️ 编辑模型：${escapeHtml(editModel.name)}` : '➕ 添加新的中转 API 模型'}
                        </span>
                        <div class="agy-ms-presets" id="agy-ms-presets-bar">
                            <span style="font-size:11px;opacity:0.65;">快捷预设:</span>
                        </div>
                    </div>

                    <div class="agy-ms-field">
                        <label>服务商（同一站点的模型共享地址和密钥）</label>
                        <select class="agy-ms-select" id="agy-ms-provider"><option value="">新服务商 / 自定义</option></select>
                        <select class="agy-ms-select" id="agy-ms-provider-preset" aria-label="服务商预设"><option value="">主流服务商一键预设</option></select>
                        <p id="agy-ms-provider-hint" style="font-size:11px;opacity:.7;">编辑已保存服务商的地址或 Key，会同步更新该服务商下所有模型。</p>
                    </div>
                    <div class="agy-ms-grid-2">
                        <div class="agy-ms-field">
                            <label>显示名称 (添加后显示在模型选择列表中)</label>
                            <input type="text" class="agy-ms-input" id="agy-ms-input-name" placeholder="例如：Claude 3.7 Sonnet / DeepSeek V3" value="${escapeHtml(editModel?.name || '')}" />
                        </div>
                        <div class="agy-ms-field">
                            <div style="display:flex;align-items:center;justify-content:space-between;">
                                <label>模型标识 (Model ID) *</label>
                                <span id="agy-ms-discover-btn" style="font-size:11px;color:#c96442;cursor:pointer;user-select:none;">🔍 从接口获取列表</span>
                            </div>
                            <input type="text" class="agy-ms-input" id="agy-ms-input-model-id" list="agy-ms-discovered-models-list" placeholder="例如：claude-3-7-sonnet-20250219 或 gpt-4o" value="${escapeHtml(editModel?.modelId || '')}" />
                            <datalist id="agy-ms-discovered-models-list"></datalist>
                        </div>
                    </div>

                    <div class="agy-ms-grid-2">
                        <div class="agy-ms-field">
                            <label>中转站接口地址 (Base URL) *</label>
                            <input type="text" class="agy-ms-input" id="agy-ms-input-base-url" placeholder="例如：https://api.xxx.com/v1 或 https://api.xxx.com" value="${escapeHtml(editModel?.baseUrl || '')}" />
                        </div>
                        <div class="agy-ms-field">
                            <label>接口协议类型</label>
                            <select class="agy-ms-select" id="agy-ms-input-protocol">
                                <option value="auto" ${(!editModel || editModel.protocol === 'auto') ? 'selected' : ''}>自动识别 (智能兼容 OpenAI 与 Claude 协议)</option>
                                <option value="openai" ${editModel?.protocol === 'openai' ? 'selected' : ''}>OpenAI 兼容协议 (/v1/chat/completions)</option>
                                <option value="anthropic" ${editModel?.protocol === 'anthropic' ? 'selected' : ''}>Anthropic 原生协议 (/v1/messages · 同 cc-switch)</option>
                            </select>
                        </div>
                    </div>

                    <div class="agy-ms-field">
                        <label>API Key *</label>
                        <div style="display:flex;gap:8px;">
                            <input type="password" class="agy-ms-input" id="agy-ms-input-api-key" placeholder="${editModel ? `已保存 (${editModel.apiKeyMasked})，留空则保持原密钥不变` : 'sk-...'}" value="" />
                            <button type="button" class="agy-ms-btn" id="agy-ms-toggle-key-btn" style="white-space:nowrap;">👁️ 显示</button>
                        </div>
                    </div>

                    <div id="agy-ms-discovered-chips" style="display:none;flex-wrap:wrap;gap:5px;padding:6px 8px;border-radius:6px;background:rgba(0,0,0,0.04);max-height:96px;overflow-y:auto;"></div>
                    <button type="button" class="agy-ms-btn" id="agy-ms-import-btn" style="display:none;">批量导入勾选模型</button>
                    <div id="agy-ms-test-result-banner" class="agy-ms-test-banner"></div>

                    <div class="agy-ms-btn-row">
                        <div style="display:flex;gap:8px;align-items:center;">
                            <button type="button" class="agy-ms-btn success" id="agy-ms-test-btn">🔌 测试连接</button>
                            ${editModel ? `<button type="button" class="agy-ms-btn" id="agy-ms-cancel-edit-btn">取消编辑</button>` : ''}
                        </div>
                        <button type="button" class="agy-ms-btn primary" id="agy-ms-save-btn">
                            ${editModel ? '💾 保存修改' : '➕ 添加到模型选择列表'}
                        </button>
                    </div>
                </div>

                <!-- 已添加模型列表（支持选用、测试连接、编辑、删除） -->
                <div>
                    <div style="font-size:13px;font-weight:600;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;">
                        <span>📋 已添加的模型 (${state.models.length})</span>
                        <span style="font-size:11.5px;opacity:0.75;">添加后会自动显示在聊天框的模型选择列表中</span>
                    </div>
                    <div class="agy-ms-model-list" id="agy-ms-saved-list"></div>
                </div>
            </div>
        `;

        backdrop.appendChild(modal);
        document.body.appendChild(backdrop);

        // 渲染预设按钮
        const presetsBar = modal.querySelector('#agy-ms-presets-bar');
        MODEL_PRESETS.forEach((preset) => {
            const chip = document.createElement('span');
            chip.className = 'agy-ms-preset-chip';
            chip.textContent = preset.label;
            chip.addEventListener('click', () => {
                const nameInput = modal.querySelector('#agy-ms-input-name');
                const idInput = modal.querySelector('#agy-ms-input-model-id');
                const protoSelect = modal.querySelector('#agy-ms-input-protocol');
                if (!nameInput.value.trim()) nameInput.value = preset.label;
                idInput.value = preset.modelId;
                protoSelect.value = preset.protocol;
            });
            presetsBar.appendChild(chip);
        });

        backdrop.addEventListener('click', () => backdrop.remove());
        modal.querySelector('#agy-ms-close-btn').addEventListener('click', () => backdrop.remove());

        const keyInput = modal.querySelector('#agy-ms-input-api-key');
        const toggleKeyBtn = modal.querySelector('#agy-ms-toggle-key-btn');
        toggleKeyBtn.addEventListener('click', () => {
            if (keyInput.type === 'password') {
                keyInput.type = 'text';
                toggleKeyBtn.textContent = '🙈 隐藏';
            } else {
                keyInput.type = 'password';
                toggleKeyBtn.textContent = '👁️ 显示';
            }
        });

        const cancelEditBtn = modal.querySelector('#agy-ms-cancel-edit-btn');
        if (cancelEditBtn) {
            cancelEditBtn.addEventListener('click', () => openModelManagerModal(null));
        }

        const bannerEl = modal.querySelector('#agy-ms-test-result-banner');
        const testBtn = modal.querySelector('#agy-ms-test-btn');
        const saveBtn = modal.querySelector('#agy-ms-save-btn');
        const discoverBtn = modal.querySelector('#agy-ms-discover-btn');
        const discoveredChipsEl = modal.querySelector('#agy-ms-discovered-chips');
        const datalistEl = modal.querySelector('#agy-ms-discovered-models-list');
        const providerSelect=modal.querySelector('#agy-ms-provider');
        const presetSelect=modal.querySelector('#agy-ms-provider-preset');
        const importBtn=modal.querySelector('#agy-ms-import-btn');
        const selectedModels=new Set();let discoverySignature='';
        for(const provider of state.providers){const option=document.createElement('option');option.value=provider.id;option.textContent=provider.name+' · '+provider.baseUrl;providerSelect.appendChild(option);}
        providerSelect.value=editModel?.providerId||'';
        providerSelect.addEventListener('change',()=>{
            const provider=state.providers.find(p=>p.id===providerSelect.value);
            modal.querySelector('#agy-ms-input-base-url').value=provider?.baseUrl||'';
            modal.querySelector('#agy-ms-input-protocol').value=provider?.protocol||'auto';
            keyInput.value='';keyInput.placeholder=provider?'已保存密钥，留空保留':'sk-...';
            selectedModels.clear();importBtn.style.display='none';discoveredChipsEl.style.display='none';
        });
        const presets=window.__agyProviderPresets||[];
        for(const preset of presets){const option=document.createElement('option');option.value=preset.id;option.textContent=preset.name;presetSelect.appendChild(option);}
        presetSelect.addEventListener('change',()=>{
            const preset=presets.find(p=>p.id===presetSelect.value);if(!preset)return;
            providerSelect.value='';keyInput.value='';keyInput.placeholder='sk-...';
            modal.querySelector('#agy-ms-input-base-url').value=preset.baseUrl;
            modal.querySelector('#agy-ms-input-protocol').value=preset.protocol;
            modal.querySelector('#agy-ms-provider-hint').textContent=preset.hint||'地址和协议已填好，填写 API Key 后拉取模型列表。';
            selectedModels.clear();importBtn.style.display='none';discoveredChipsEl.style.display='none';
        });

        function readFormDraft() {
            const name = modal.querySelector('#agy-ms-input-name').value.trim();
            const modelId = modal.querySelector('#agy-ms-input-model-id').value.trim();
            const baseUrl = modal.querySelector('#agy-ms-input-base-url').value.trim();
            const apiKey = modal.querySelector('#agy-ms-input-api-key').value.trim();
            const protocol = modal.querySelector('#agy-ms-input-protocol').value;
            return {
                id: state.editingModelId || undefined,
                name: name || modelId,
                modelId,
                baseUrl,
                apiKey,
                protocol
                ,providerId:providerSelect.value||null
            };
        }

        // 从中转站 /v1/models 拉取可用模型列表
        discoverBtn.addEventListener('click', async () => {
            const draft = readFormDraft();
            if (!draft.baseUrl || (!draft.apiKey && !draft.id && !draft.providerId)) {
                bannerEl.className = 'agy-ms-test-banner err';
                bannerEl.textContent = '❌ 请先填写【中转站接口地址 (Base URL)】和【API Key】，再点击获取模型列表。';
                return;
            }
            discoverBtn.textContent = '⏳ 正在拉取...';
            try {
                const res = await apiFetch('/discover', {
                    method: 'POST',
                    body: draft
                });
                if (res && res.ok && Array.isArray(res.models) && res.models.length > 0) {
                    datalistEl.innerHTML = res.models.map(id => `<option value="${escapeHtml(id)}"></option>`).join('');
                    discoveredChipsEl.style.display = 'flex';
                    discoverySignature=JSON.stringify([draft.providerId,draft.baseUrl,draft.apiKey,draft.protocol]);selectedModels.clear();importBtn.style.display='inline-block';
                    discoveredChipsEl.innerHTML = `<span style="font-size:11px;opacity:0.75;width:100%;">发现 ${res.models.length} 个模型，勾选后批量导入：</span>`;
                    res.models.forEach((mId) => {
                        const chip = document.createElement('label');
                        chip.className = 'agy-ms-preset-chip';
                        const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.value=mId;
                        checkbox.addEventListener('change',()=>{if(checkbox.checked)selectedModels.add(mId);else selectedModels.delete(mId);});
                        chip.append(checkbox,document.createTextNode(mId));
                        discoveredChipsEl.appendChild(chip);
                    });
                    bannerEl.className = 'agy-ms-test-banner ok';
                    bannerEl.textContent = `✅ 已成功从 ${res.endpointUrl} 获取到 ${res.models.length} 个模型！`;
                } else {
                    bannerEl.className = 'agy-ms-test-banner err';
                    bannerEl.textContent = `ℹ️ ${res?.error || '未能获取到模型列表，请直接手动输入模型 ID'}`;
                }
            } catch (err) {
                bannerEl.className = 'agy-ms-test-banner err';
                bannerEl.textContent = `❌ 获取模型列表失败: ${err.message || err}`;
            } finally {
                discoverBtn.textContent = '🔍 从接口获取列表';
            }
        });

        importBtn.addEventListener('click',async()=>{
            const draft=readFormDraft();
            if(discoverySignature!==JSON.stringify([draft.providerId,draft.baseUrl,draft.apiKey,draft.protocol])){bannerEl.textContent='连接信息已改变，请重新拉取模型列表';return;}
            if(!selectedModels.size){bannerEl.textContent='请先勾选模型';return;}
            importBtn.disabled=true;
            try{await apiFetch('/import',{method:'POST',body:{...draft,id:undefined,modelIds:[...selectedModels]}});await refreshState();openModelManagerModal(null);}
            catch(error){bannerEl.className='agy-ms-test-banner err';bannerEl.textContent=error.message;}
            finally{importBtn.disabled=false;}
        });

        // 测试连接按钮逻辑
        testBtn.addEventListener('click', async () => {
            const draft = readFormDraft();
            if (!draft.modelId || !draft.baseUrl || (!draft.apiKey && !draft.id && !draft.providerId)) {
                bannerEl.className = 'agy-ms-test-banner err';
                bannerEl.textContent = '❌ 请先完整填写【模型标识 (Model ID)】、【中转站接口地址 (Base URL)】和【API Key】后再测试连接。';
                return;
            }
            testBtn.disabled = true;
            testBtn.textContent = '⏳ 测试中...';
            bannerEl.className = 'agy-ms-test-banner loading';
            bannerEl.textContent = `🔄 正在向 ${draft.baseUrl} 发送握手测试请求 (模型: ${draft.modelId})...`;

            try {
                const res = await apiFetch('/test', {
                    method: 'POST',
                    body: draft
                });
                const r = res?.result || {};
                if (res && res.ok && r.ok) {
                    bannerEl.className = 'agy-ms-test-banner ok';
                    bannerEl.innerHTML = `✅ <b>连接测试成功！</b> · 延迟: <b>${r.latencyMs} ms</b> · 协议: <b>${escapeHtml(r.resolvedProtocol)}</b><br/>请求端点: <code>${escapeHtml(r.endpointUrl)}</code> · 返回: "${escapeHtml(r.replyPreview)}"`;
                } else {
                    bannerEl.className = 'agy-ms-test-banner err';
                    bannerEl.innerHTML = `❌ <b>连接测试失败</b>: ${escapeHtml(r.error || res?.error || '未知错误')}${r.endpointUrl ? `<br/>尝试端点: <code>${escapeHtml(r.endpointUrl)}</code>` : ''}`;
                }
                await refreshState();
                renderSavedModelsList(modal);
            } catch (err) {
                bannerEl.className = 'agy-ms-test-banner err';
                bannerEl.textContent = `❌ 本地服务通信异常: ${err.message || err}`;
            } finally {
                testBtn.disabled = false;
                testBtn.textContent = '🔌 测试连接';
            }
        });

        // 保存按钮逻辑
        saveBtn.addEventListener('click', async () => {
            const draft = readFormDraft();
            if (!draft.modelId || !draft.baseUrl || (!draft.apiKey && !draft.id && !draft.providerId)) {
                bannerEl.className = 'agy-ms-test-banner err';
                bannerEl.textContent = '❌ 请填写完整的【模型标识 (Model ID)】、【中转站接口地址 (Base URL)】和【API Key】。';
                return;
            }
            saveBtn.disabled = true;
            saveBtn.textContent = '⏳ 正在保存...';
            try {
                const res = await apiFetch('/save', {
                    method: 'POST',
                    body: { ...draft, autoActivate: true }
                });
                if (!res || !res.ok) {
                    bannerEl.className = 'agy-ms-test-banner err';
                    bannerEl.textContent = `❌ 保存失败: ${res?.error || '未知错误'}`;
                    return;
                }
                await refreshState();
                openModelManagerModal(null);
                const newModal = document.querySelector('#agy-model-manager-backdrop .agy-ms-modal');
                if (newModal) {
                    const b = newModal.querySelector('#agy-ms-test-result-banner');
                    if (b) {
                        b.className = 'agy-ms-test-banner ok';
                        b.innerHTML = `✅ 已添加模型 <b>${escapeHtml(res.model.name)}</b>！现在可以直接在聊天框的模型选择列表中选择它。`;
                    }
                }
            } catch (err) {
                bannerEl.className = 'agy-ms-test-banner err';
                bannerEl.textContent = `❌ 保存失败: ${err.message || err}`;
            } finally {
                saveBtn.disabled = false;
            }
        });

        renderSavedModelsList(modal);
    }

    function renderSavedModelsList(modal) {
        const listEl = modal.querySelector('#agy-ms-saved-list');
        if (!listEl) return;
        listEl.innerHTML = '';

        if (state.models.length === 0) {
            listEl.innerHTML = `<div style="padding:14px;text-align:center;opacity:0.65;font-size:12.5px;border:1px dashed var(--border, rgba(0,0,0,0.18));border-radius:8px;">暂未添加任何中转模型。在上方填写模型信息并添加后，模型会自动出现在聊天的模型选择列表中。</div>`;
            return;
        }

        for (const m of state.models) {
            const isCurrent = state.activeMode === 'custom' && state.activeModelId === m.id;
            const card = document.createElement('div');
            card.className = `agy-ms-model-card${isCurrent ? ' active' : ''}`;

            const statusBadge = m.lastTestOk === true
                ? `<span class="agy-ms-tag ok">✅ 连通 (${m.lastTestLatencyMs}ms)</span>`
                : (m.lastTestOk === false
                    ? `<span class="agy-ms-tag" style="color:#dc2626;" title="${escapeHtml(m.lastTestError)}">❌ 异常</span>`
                    : `<span class="agy-ms-tag">未测试</span>`);

            card.innerHTML = `
                <div style="display:flex;flex-direction:column;gap:3px;min-width:0;flex:1;">
                    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                        <span style="font-size:13.5px;font-weight:600;">${escapeHtml(m.name)}</span>
                        <code style="font-size:11px;padding:1px 6px;border-radius:4px;background:var(--secondary, rgba(0,0,0,0.06));">${escapeHtml(m.modelId)}</code>
                        <span class="agy-ms-tag">${escapeHtml(m.protocol.toUpperCase())}</span>
                        ${statusBadge}
                    </div>
                    <div style="font-size:11.5px;opacity:0.68;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                        接口: ${escapeHtml(m.baseUrl)} · Key: ${escapeHtml(m.apiKeyMasked)}
                    </div>
                </div>
                <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
                    <button type="button" class="agy-ms-btn ${isCurrent ? 'success' : ''}" data-act="use">
                        ${isCurrent ? '✓ 当前选中' : '选用'}
                    </button>
                    <button type="button" class="agy-ms-btn" data-act="test">🔌 测试</button>
                    <button type="button" class="agy-ms-btn" data-act="edit">✏️ 编辑</button>
                    <button type="button" class="agy-ms-btn danger" data-act="del">🗑️ 删除</button>
                </div>
            `;

            card.querySelector('[data-act="use"]').addEventListener('click', async () => {
                await selectModel('custom', m.id);
                renderSavedModelsList(modal);
            });

            const itemTestBtn = card.querySelector('[data-act="test"]');
            itemTestBtn.addEventListener('click', async () => {
                itemTestBtn.disabled = true;
                itemTestBtn.textContent = '⏳...';
                const bannerEl = modal.querySelector('#agy-ms-test-result-banner');
                try {
                    const res = await apiFetch('/test', {
                        method: 'POST',
                        body: { id: m.id }
                    });
                    const r = res?.result || {};
                    if (bannerEl) {
                        if (r.ok) {
                            bannerEl.className = 'agy-ms-test-banner ok';
                            bannerEl.innerHTML = `✅ <b>[${escapeHtml(m.name)}] 连接测试通过！</b> 延迟: <b>${r.latencyMs} ms</b> · 协议: <b>${escapeHtml(r.resolvedProtocol)}</b> · 响应: "${escapeHtml(r.replyPreview)}"`;
                        } else {
                            bannerEl.className = 'agy-ms-test-banner err';
                            bannerEl.innerHTML = `❌ <b>[${escapeHtml(m.name)}] 连接测试失败:</b> ${escapeHtml(r.error || '未知错误')}`;
                        }
                    }
                    await refreshState();
                    renderSavedModelsList(modal);
                } finally {
                    itemTestBtn.disabled = false;
                    itemTestBtn.textContent = '🔌 测试';
                }
            });

            card.querySelector('[data-act="edit"]').addEventListener('click', () => {
                openModelManagerModal(m);
            });

            card.querySelector('[data-act="del"]').addEventListener('click', async () => {
                await apiFetch('/delete', {
                    method: 'POST',
                    body: { id: m.id }
                });
                await refreshState();
                openModelManagerModal(null);
            });

            listEl.appendChild(card);
        }
    }

    /**
     * 查找当前聊天窗口的主对话流容器（若在新建会话首页，则在输入框卡片外层上方创建对话流容器）
     */
    function findConversationLogContainer(editorEl = null) {
        const pathname = window.location.pathname || '';
        if (pathname.startsWith('/c/')) {
            const srHeadings = document.querySelectorAll('h1.sr-only');
            for (const h of srHeadings) {
                const t = (h.textContent || '').trim();
                if ((t === 'Conversation Log' || t === '会话日志') && h.parentElement) {
                    return h.parentElement;
                }
            }
            const fallback = document.querySelector('div.relative.flex.flex-col.gap-y-3:not(#agy-ms-startpage-chat-log)');
            if (fallback && !fallback.contains(document.querySelector('[data-lexical-editor="true"]'))) return fallback;
        }

        let startPageLog = document.getElementById('agy-ms-startpage-chat-log');
        const targetEditor = editorEl || document.querySelector('div[data-lexical-editor="true"][contenteditable="true"]');
        const composerBox = targetEditor ? findComposerBox(targetEditor) : null;

        // Use the native input boundary; nested flex/card decorations are not chat containers.
        let outerComposer = targetEditor?.closest('[data-testid="agent-input-box"]') || composerBox;
        if (outerComposer?.parentElement?.classList.contains('contents')) {
            outerComposer = outerComposer.parentElement;
        }
        if (startPageLog && startPageLog.getAttribute('data-agy-conversation-id') !== getActiveConversationId()) {
            startPageLog.remove();
            startPageLog = null;
        }

        // 若旧的 startPageLog 被误挂载在输入框卡片内部，将其移出到 outerComposer 上方
        if (startPageLog && outerComposer && outerComposer.contains(startPageLog) && outerComposer.parentElement) {
            outerComposer.parentElement.insertBefore(startPageLog, outerComposer);
        }

        if (startPageLog) return startPageLog;

        if (outerComposer && outerComposer.parentElement) {
            // 隐藏新建会话页的问候语与快捷胶囊，切换为对话流视图
            document.querySelectorAll('.agy-claude-hero-greeting, .agy-claude-starter-pills').forEach(el => {
                el.style.display = 'none';
            });
            startPageLog = document.createElement('div');
            startPageLog.id = 'agy-ms-startpage-chat-log';
            startPageLog.setAttribute('data-agy-conversation-id', getActiveConversationId());
            startPageLog.setAttribute(SKIP_I18N_ATTR, 'true');
            startPageLog.className = 'relative flex flex-col gap-y-3 w-full max-w-3xl mx-auto px-4 pb-4';
            startPageLog.style.cssText = 'max-height:65vh;overflow-y:auto;flex-shrink:0;';
            outerComposer.parentElement.insertBefore(startPageLog, outerComposer);
            return startPageLog;
        }
        return null;
    }

    /**
     * 通过 Lexical 内部状态安全、彻底地清空聊天输入框
     */
    function clearLexicalEditor(editorEl) {
        if (!editorEl) return;
        const lex = editorEl.__lexicalEditor;
        if (lex && typeof lex.update === 'function') {
            try {
                lex.update(() => {
                    const st = lex._pendingEditorState || lex.getEditorState();
                    const root = st && st._nodeMap ? st._nodeMap.get('root') : null;
                    if (root && typeof root.getWritable === 'function') {
                        root.getWritable().clear();
                    }
                }, { discrete: true });
                return;
            } catch {
                // fallback
            }
        }
        editorEl.focus();
        try {
            const sel = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(editorEl);
            sel.removeAllRanges();
            sel.addRange(range);
            document.execCommand('delete', false, null);
        } catch {
            // fallback
        }
    }

    function clearSubmittedComposer(editorEl, draftKey = (window.location.pathname.match(/^\/c\/([^/]+)/)?.[1] || '__home__')) {
        const composer = nativeContext(editorEl).composer;
        clearLexicalEditor(editorEl);
        clearComposerAttachments(findComposerBox(editorEl));
        // Native draft saving is debounced and its unmount cleanup retains an existing
        // draft when the editor is empty. Match the native submit path's explicit delete.
        composer?.draftsRef.current?.delete(draftKey);
    }

    /**
     * 向 Lexical 编辑器末尾同步追加文本（用于从 Custom 模型切回 Official 模型时无缝附带未同步的上下文）
     */
    function appendTextToLexicalEditor(editorEl, extraText) {
        if (!editorEl || !extraText) return;
        const lex = editorEl.__lexicalEditor;
        if (lex && typeof lex.update === 'function') {
            try {
                let appended = false;
                lex.update(() => {
                    const st = lex._pendingEditorState || lex.getEditorState();
                    if (!st || !st._nodeMap) return;
                    let lastTextNode = null;
                    for (const [, node] of st._nodeMap.entries()) {
                        if (node && node.__type === 'text' && typeof node.setTextContent === 'function') {
                            lastTextNode = node;
                        }
                    }
                    if (lastTextNode) {
                        lastTextNode.setTextContent(lastTextNode.getTextContent() + '\n\n' + extraText);
                        appended = true;
                    }
                }, { discrete: true });
                if (appended) return true;
            } catch {
                // fallback
            }
        }
        editorEl.focus();
        try {
            const sel = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(editorEl);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
            return document.execCommand('insertText', false, `\n\n${extraText}`);
        } catch {
            // ignore
        }
        return false;
    }

    /**
     * 查找中转模型对话轮次的最佳挂载容器：
     * 直接返回 conversation log container 本身（自定义轮次追加在末尾），
     * 仅移除最后一个官方轮次的整屏 min-height 留白（calc(100cqh-...)），避免对官方轮次的 DOM 结构或样式做侵入式修改。
     */
    function findCustomTurnMountTarget(container) {
        if (!container) return container;
        // 仅对最后一个官方轮次移除整屏留白的 min-height（如 calc(100cqh - 50px)），不修改其它官方轮次
        const officialTurns = Array.from(container.querySelectorAll(':scope > div.flex.items-start'));
        if (officialTurns.length > 0) {
            const lastTurn = officialTurns[officialTurns.length - 1];
            const mh = lastTurn.style?.minHeight || '';
            if (mh.includes('calc(') || mh.includes('100cqh') || mh.includes('100dvh')) {
                lastTurn.style.minHeight = '0px';
                lastTurn.setAttribute('data-agy-mh-cleared', '1');
            }
        }
        // 自定义轮次直接追加在 container 末尾，不塞入官方轮次内部
        return container;
    }

    /**
     * 缓存用户在输入框中粘贴/拖拽/选择的原始高清图片文件（避免被 Antigravity 320px 预览缩略图压缩导致模型看不清文字）
     */
    let pendingPastedImages = [];

    function readFileAsDataUrl(file) {
        return new Promise((resolve) => {
            if (!file || !String(file.type || '').startsWith('image/')) {
                resolve(null);
                return;
            }
            const reader = new FileReader();
            reader.onload = () => {
                const dataUrl = typeof reader.result === 'string' ? reader.result : '';
                if (dataUrl.startsWith('data:image/')) {
                    resolve({
                        mediaType: file.type || 'image/png',
                        dataUrl,
                        name: file.name || 'screenshot.png',
                        addedAt: Date.now()
                    });
                } else {
                    resolve(null);
                }
            };
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(file);
        });
    }

    async function captureFilesIntoPending(fileList) {
        if (!fileList || fileList.length === 0) return;
        const files = Array.from(fileList).filter(f => f && String(f.type || '').startsWith('image/'));
        if (files.length === 0) return;
        const conversationId = getActiveConversationId();
        const loaded = (await Promise.all(files.map(readFileAsDataUrl))).filter(Boolean);
        if (disposed || conversationId !== getActiveConversationId()) return;
        const now = Date.now();
        pendingPastedImages = pendingPastedImages.filter(item => now - item.addedAt < 600000);
        for (const img of loaded) {
            if (!pendingPastedImages.some(x => x.dataUrl === img.dataUrl)) {
                pendingPastedImages.push({ ...img, conversationId });
            }
        }
    }

    function onGlobalPaste(e) {
        const target = e.target;
        if (!target || !(target instanceof Element)) return;
        if (!findComposerBox(target)) return;
        const dt = e.clipboardData;
        if (!dt) return;
        if (dt.files && dt.files.length > 0) {
            captureFilesIntoPending(dt.files);
        } else if (dt.items && dt.items.length > 0) {
            const files = [];
            for (const item of dt.items) {
                if (item.kind === 'file' && String(item.type || '').startsWith('image/')) {
                    const f = item.getAsFile();
                    if (f) files.push(f);
                }
            }
            if (files.length > 0) captureFilesIntoPending(files);
        }
    }

    function onGlobalDrop(e) {
        const target = e.target;
        if (!target || !(target instanceof Element)) return;
        if (!findComposerBox(target)) return;
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            captureFilesIntoPending(e.dataTransfer.files);
        }
    }

    function onGlobalFileInputChange(e) {
        const target = e.target;
        if (!target || !(target instanceof HTMLInputElement) || target.type !== 'file') return;
        if (!findComposerBox(target)) return;
        if (target.files && target.files.length > 0) {
            captureFilesIntoPending(target.files);
        }
    }

    /**
     * 从粘贴缓存（100% 原始高清分辨率）与输入框 DOM 中提取当前附带的所有截图
     * 增强版：对 DOM 回退路径使用 blob URL fetch 获取原始分辨率，避免使用已被 Antigravity 压缩过的 320px 缩略图
     */
    function extractComposerImages(composerBox) {
        const images = [];
        const addUnique = (mediaType, dataUrl, name = 'screenshot.png') => {
            if (!dataUrl || !dataUrl.startsWith('data:image/')) return;
            if (!images.some(x => x.dataUrl === dataUrl)) {
                images.push({ mediaType: mediaType || 'image/png', dataUrl, name });
            }
        };

        const domImgs = composerBox
            ? Array.from(composerBox.querySelectorAll('div[data-testid="input-attachment"] img, img[alt="Image attachment"]'))
            : [];

        // 1. 优先使用粘贴/拖拽/上传事件捕获的 100% 原始分辨率图片（避免使用 Antigravity 压成 320px 的缩略图）
        const now = Date.now();
        const freshPending = pendingPastedImages.filter(item => now - item.addedAt < 600000 && item.conversationId === getActiveConversationId());
        if (freshPending.length > 0 && domImgs.length > 0) {
            const selected = freshPending.length === domImgs.length ? freshPending : [];
            selected.forEach(item => addUnique(item.mediaType, item.dataUrl, item.name));
        }

        // 2. 若粘贴缓存数量少于当前 DOM 附件数量，再用 DOM 里的 img 补齐剩余部分
        //    注意：Antigravity 的 <img> 预览缩略图已被压缩到 ~320px，需要尝试获取原始分辨率
        if (domImgs.length > images.length) {
            domImgs.slice(images.length).forEach((imgEl, idx) => {
                const src = String(imgEl.src || '').trim();
                const removeBtn = imgEl.parentElement?.querySelector('button[aria-label^="Remove "]');
                const inferredName = removeBtn
                    ? removeBtn.getAttribute('aria-label').replace(/^Remove\s+/i, '').trim()
                    : `image-${idx + 1}.png`;

                if (src.startsWith('data:image/')) {
                    // 已经是 data URL（可能是高清的），直接使用
                    const m = src.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);
                    addUnique(m ? m[1] : 'image/png', src, inferredName);
                } else if (src.startsWith('blob:') || src.startsWith('http')) {
                    // blob: URL 或 HTTP URL — 尝试异步获取原始文件（同步回退：用高分辨率 canvas 抓取）
                    // 注：extractComposerImages 是同步函数，此处先用 canvas 回退，同时触发异步获取并缓存
                    if (imgEl.complete && imgEl.naturalWidth > 0) {
                        try {
                            // 以 CSS 显示尺寸的 2 倍或原始尺寸中较大的一个作为 canvas 尺寸
                            const w = imgEl.naturalWidth;
                            const h = imgEl.naturalHeight;
                            const canvas = document.createElement('canvas');
                            canvas.width = Math.min(w, 4096);
                            canvas.height = Math.min(h, 4096);
                            const ctx = canvas.getContext('2d');
                            ctx.imageSmoothingEnabled = true;
                            ctx.imageSmoothingQuality = 'high';
                            ctx.drawImage(imgEl, 0, 0, canvas.width, canvas.height);
                            const dataUrl = canvas.toDataURL('image/png');
                            addUnique('image/png', dataUrl, inferredName);
                        } catch {
                            // ignore canvas taint error
                        }
                    }
                    // 同时触发 blob URL 的异步获取，放入 pendingPastedImages 供下次使用
                    if (src.startsWith('blob:')) {
                        const capturedCid = getActiveConversationId();
                        fetch(src).then(r => r.blob()).then(blob => {
                            const reader = new FileReader();
                            reader.onload = () => {
                                const dataUrl = typeof reader.result === 'string' ? reader.result : '';
                                if (!disposed && imgEl.isConnected && capturedCid === getActiveConversationId() && dataUrl.startsWith('data:image/')) {
                                    pendingPastedImages.push({
                                        mediaType: blob.type || 'image/png',
                                        dataUrl,
                                        name: inferredName,
                                        conversationId: capturedCid,
                                        addedAt: Date.now()
                                    });
                                }
                            };
                            reader.readAsDataURL(blob);
                        }).catch(() => {});
                    }
                } else if (imgEl.complete && imgEl.naturalWidth > 0) {
                    try {
                        const canvas = document.createElement('canvas');
                        canvas.width = imgEl.naturalWidth;
                        canvas.height = imgEl.naturalHeight;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(imgEl, 0, 0);
                        const dataUrl = canvas.toDataURL('image/png');
                        addUnique('image/png', dataUrl, inferredName);
                    } catch {
                        // ignore canvas taint error
                    }
                }
            });
        }

        return images;
    }

    /**
     * 发送后自动清空输入框中的附件缩略图与粘贴缓存
     */
    function clearComposerAttachments(composerBox) {
        pendingPastedImages = [];
        if (!composerBox) return;
        const removeBtns = composerBox.querySelectorAll(
            'div[data-testid="input-attachment"] button[aria-label^="Remove"], div[data-testid="input-attachment"] button'
        );
        removeBtns.forEach(btn => {
            try { btn.click(); } catch {}
        });
    }

    /**
     * 点击聊天气泡中的截图缩略图时弹出全屏高清预览
     */
    function openImagePreviewModal(dataUrl) {
        if (!dataUrl) return;
        const overlay = document.createElement('div');
        overlay.setAttribute(SKIP_I18N_ATTR, 'true');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.78);display:flex;align-items:center;justify-content:center;padding:24px;cursor:zoom-out;';
        overlay.innerHTML = `<img src="${dataUrl}" style="max-width:92vw;max-height:90vh;border-radius:10px;box-shadow:0 20px 60px rgba(0,0,0,0.5);object-fit:contain;" />`;
        overlay.addEventListener('click', () => overlay.remove());
        document.body.appendChild(overlay);
    }

    /**
     * 在回复区创建或更新 Agent 工具调用步骤卡片（如：📖 读取文件、✏️ 编辑文件、💻 执行命令）
     */
    function upsertToolStepCard(toolStepsEl, step, isRunning = false) {
        if (!toolStepsEl || !step || !step.id) return;
        toolStepsEl.style.display = 'flex';
        let card = toolStepsEl.querySelector(`[data-step-id="${step.id}"]`);
        if (!card) {
            card = document.createElement('div');
            card.className = 'agy-ms-tool-card';
            card.setAttribute('data-step-id', step.id);
            card.setAttribute(SKIP_I18N_ATTR, 'true');
            toolStepsEl.appendChild(card);
        }
        const statusIcon = isRunning
            ? `<span class="agy-ms-spinner" style="width:11px;height:11px;"></span>`
            : step.ok === false
                ? `<span style="color:#dc2626;font-weight:bold;">✕</span>`
                : `<span style="color:#059669;font-weight:bold;">✓</span>`;
        const rightText = isRunning ? '正在执行...' : (step.summary || (step.ok === false ? '失败' : '完成'));
        card.innerHTML = `
            <div class="agy-ms-tool-card-left">
                ${statusIcon}
                <span style="font-weight:500;flex-shrink:0;">${escapeHtml(step.title || step.name || '工具调用')}</span>
                <span class="agy-ms-tool-card-detail" title="${escapeHtml(step.detail || '')}">${escapeHtml(step.detail || '')}</span>
            </div>
            <div class="agy-ms-tool-card-right">${escapeHtml(rightText)}</div>
        `;
    }

    /**
     * 在主聊天记录中以原生一致的视觉样式渲染中转模型无缝对话轮次（支持显示附带截图、实时状态栏、思考过程与本地工具调用卡片）
     */
    function renderCustomTurnInChatLog(promptText, modelObj, editorEl, exchangeId = '', autoScroll = true, images = []) {
        const native = syncNativeConversation();
        const container = native ? document.createElement('div') : findConversationLogContainer(editorEl);
        if (!container) return null;
        // 触发移除最后一个官方轮次的整屏留白
        findCustomTurnMountTarget(container);
        const mountTarget = container;

        const cleanPrompt = stripBridgeMarkers(promptText);
        const wrapper = document.createElement('div');
        wrapper.className = 'agy-ms-custom-turn-group flex flex-col gap-y-3 my-2 w-full';
        wrapper.setAttribute('data-agy-conversation-id', getActiveConversationId());
        wrapper.setAttribute(SKIP_I18N_ATTR, 'true');
        if (exchangeId) {
            wrapper.setAttribute('data-agy-exchange-id', exchangeId);
        }

        // 用户提问气泡（与 Antigravity 原生 user-input-step 样式一致，支持显示附带的截图缩略图）
        const userStep = document.createElement('div');
        userStep.setAttribute('data-testid', 'user-input-step');
        userStep.className = 'flex flex-col w-full gap-2 pt-3';
        userStep.innerHTML = `
            <div class="w-full">
                <div class="relative p-px rounded-xl bg-card-border">
                    <div class="relative flex flex-col gap-2 p-2.5 rounded-[calc(theme(borderRadius.xl)-1px)] bg-card overflow-hidden">
                        <div class="agy-ms-user-images flex flex-wrap gap-2" style="display:none;"></div>
                        <div class="flex-1 p-0.5 overflow-hidden">
                            <div class="whitespace-pre-wrap text-sm user-msg-text"></div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        userStep.querySelector('.user-msg-text').textContent = cleanPrompt;

        const imgContainer = userStep.querySelector('.agy-ms-user-images');
        if (Array.isArray(images) && images.length > 0 && imgContainer) {
            imgContainer.style.display = 'flex';
            images.forEach((imgObj) => {
                const url = typeof imgObj === 'string' ? imgObj : (imgObj?.dataUrl || '');
                if (!url) return;
                const thumb = document.createElement('img');
                thumb.src = url;
                thumb.alt = 'Attached screenshot';
                thumb.title = '点击查看原图';
                thumb.style.cssText = 'height:64px;max-width:140px;object-fit:cover;border-radius:8px;border:1px solid var(--border, rgba(128,128,128,0.25));cursor:zoom-in;';
                thumb.addEventListener('click', () => openImagePreviewModal(url));
                imgContainer.appendChild(thumb);
            });
        }

        // 中转 API 模型回复区域（包含：1. 实时任务状态栏 2. 实时可折叠思考过程 3. Agent 工具执行卡片 4. 实时流式正文区 5. 底部元信息）
        const assistantStep = document.createElement('div');
        assistantStep.className = 'flex flex-col w-full gap-1.5 px-1 py-1 text-sm leading-relaxed text-foreground';
        assistantStep.innerHTML = `
            <div class="agy-ms-live-status">
                <span class="agy-ms-spinner"></span>
                <span class="agy-ms-status-text">正在连接中转站 API (${escapeHtml(modelObj?.name || '自定义模型')})...</span>
            </div>
            <div class="agy-ms-thinking-wrap" style="display:none;">
                <details open class="agy-ms-thinking-box">
                    <summary class="agy-ms-thinking-summary">💭 正在深度思考...</summary>
                    <div class="agy-ms-thinking-content"></div>
                </details>
            </div>
            <div class="agy-ms-tool-steps" style="display:none;"></div>
            <div class="agy-ms-chat-body break-words"></div>
            <div class="flex items-center justify-end gap-2 text-xs text-muted-foreground opacity-75 pt-1">
                <span class="agy-ms-turn-meta">⚡ ${escapeHtml(modelObj?.name || '自定义中转模型')} (${escapeHtml(modelObj?.modelId || '')}) · 实时流式连接中...</span>
            </div>
        `;

        wrapper.appendChild(userStep);
        wrapper.appendChild(assistantStep);
        mountTarget.appendChild(wrapper);
        if (autoScroll) {
            wrapper.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        let nativeExchange = null;
        if (native && !exchangeId) {
            const cid = getActiveConversationId();
            const provider = nativeContext().states.peek(cid);
            const base = nativeOverlays.get(provider)?.base;
            nativeExchange = { id: `live-${crypto.randomUUID()}`, conversationId: cid, createdAt: Date.now(),
                afterOfficialStepIndex: (base?.trajectorySlice?.totalStepsLength || 0) - 1,
                userPrompt: cleanPrompt, assistantReply: '', reasoning: '', images, toolSteps: [], running: true };
            liveNativeTurns.set(nativeExchange.id, nativeExchange);
            syncNativeConversation();
        }
        return {
            nativeExchange,
            wrapper,
            statusWrapEl: assistantStep.querySelector('.agy-ms-live-status'),
            statusTextEl: assistantStep.querySelector('.agy-ms-status-text'),
            thinkingWrapEl: assistantStep.querySelector('.agy-ms-thinking-wrap'),
            thinkingDetailsEl: assistantStep.querySelector('.agy-ms-thinking-box'),
            thinkingSummaryEl: assistantStep.querySelector('.agy-ms-thinking-summary'),
            thinkingContentEl: assistantStep.querySelector('.agy-ms-thinking-content'),
            toolStepsEl: assistantStep.querySelector('.agy-ms-tool-steps'),
            metaEl: assistantStep.querySelector('.agy-ms-turn-meta'),
            bodyEl: assistantStep.querySelector('.agy-ms-chat-body')
        };
    }

    /**
     * 当在侧边栏切换回已有会话 (`/c/<uuid>` 或纯 API 会话 `startpage-*`) 时，自动将持久化的中转 API 问答轮次渲染回对话流中
     */
    function syncPersistedCustomTurnsInChatLog() {
        if (deletedConversations.has(getActiveConversationId())) return;
        if (syncNativeConversation()) return;
        const cid = getActiveConversationId();
        if (!cid || !state.bridge || state.bridge.conversationId !== cid || !Array.isArray(state.bridge.exchanges)) {
            return;
        }
        // 在新建会话首页 (/) 如果当前会话没有任何历史问答且未在发送中，不提前创建空白容器
        if (!(window.location.pathname || '').startsWith('/c/') && state.bridge.exchanges.length === 0) {
            return;
        }

        const container = findConversationLogContainer(null);
        if (!container) return;
        const mountTarget = container;

        container.querySelectorAll('.agy-ms-custom-turn-group').forEach(el => {
            if (el.getAttribute('data-agy-conversation-id') !== cid) el.remove();
        });

        // mountTarget 现在始终等于 container，不再需要迁移

        for (const ex of state.bridge.exchanges) {
            if (!ex || !ex.id || (!ex.assistantReply && !ex.reasoning)) continue;
            let existingEl = container.querySelector(`[data-agy-exchange-id="${ex.id}"]`);
            if (!existingEl) {
                const candidates = Array.from(container.querySelectorAll('.agy-ms-custom-turn-group:not([data-agy-exchange-id])'));
                const promptClean = stripBridgeMarkers(ex.userPrompt || '');
                existingEl = candidates.find(el => {
                    const u = el.querySelector('.user-msg-text');
                    return u && (u.textContent || '').trim() === promptClean;
                }) || null;
                if (existingEl) {
                    existingEl.setAttribute('data-agy-exchange-id', ex.id);
                }
            }

            if (existingEl) {
                const statusEl = existingEl.querySelector('.agy-ms-live-status');
                if (statusEl && !state.isSendingCustomChat) {
                    statusEl.style.display = 'none';
                }
                const toolStepsEl = existingEl.querySelector('.agy-ms-tool-steps');
                if (toolStepsEl && Array.isArray(ex.toolSteps) && ex.toolSteps.length > 0) {
                    ex.toolSteps.forEach(st => upsertToolStepCard(toolStepsEl, st, false));
                }
                const bodyEl = existingEl.querySelector('.agy-ms-chat-body');
                if (bodyEl && bodyEl.getAttribute('data-agy-katex-rendered') !== 'true') {
                    const thinkingWrap = existingEl.querySelector('.agy-ms-thinking-wrap');
                    if (ex.reasoning && thinkingWrap) {
                        thinkingWrap.style.display = 'block';
                        const detailsEl = thinkingWrap.querySelector('details');
                        if (detailsEl) detailsEl.open = false;
                        const sumEl = thinkingWrap.querySelector('.agy-ms-thinking-summary');
                        if (sumEl) sumEl.textContent = '💭 思考过程';
                        const cntEl = thinkingWrap.querySelector('.agy-ms-thinking-content');
                        if (cntEl) cntEl.textContent = ex.reasoning;
                        bodyEl.innerHTML = `<div>${formatSimpleMarkdown(ex.assistantReply || '')}</div>`;
                    } else {
                        let displayHtml = '';
                        if (ex.reasoning) {
                            displayHtml += `<details class="agy-ms-thinking-box"><summary>💭 思考过程</summary><div class="agy-ms-thinking-content">${escapeHtml(ex.reasoning)}</div></details>`;
                        }
                        displayHtml += `<div>${formatSimpleMarkdown(ex.assistantReply || '')}</div>`;
                        bodyEl.innerHTML = displayHtml;
                    }
                    bodyEl.classList.remove('whitespace-pre-wrap');
                    bodyEl.setAttribute('data-agy-katex-rendered', 'true');
                }
                continue;
            }

            const turn = renderCustomTurnInChatLog(
                ex.userPrompt || '',
                { name: ex.modelName || ex.modelId || '中转模型', modelId: ex.modelId || '' },
                null,
                ex.id,
                false,
                Array.isArray(ex.images) ? ex.images : []
            );
            if (turn) {
                if (turn.statusWrapEl) turn.statusWrapEl.style.display = 'none';
                const toolCountBadge = Array.isArray(ex.toolSteps) && ex.toolSteps.length > 0
                    ? ` · 🛠️ 调用 ${ex.toolSteps.length} 项工具`
                    : '';
                turn.metaEl.textContent = `⚡ ${ex.modelName || ex.modelId || '中转模型'} · ${(ex.protocol || 'API').toUpperCase()} 直连${toolCountBadge}`;
                if (Array.isArray(ex.toolSteps) && ex.toolSteps.length > 0 && turn.toolStepsEl) {
                    ex.toolSteps.forEach(st => upsertToolStepCard(turn.toolStepsEl, st, false));
                }
                if (ex.reasoning && turn.thinkingWrapEl) {
                    turn.thinkingWrapEl.style.display = 'block';
                    if (turn.thinkingDetailsEl) turn.thinkingDetailsEl.open = false;
                    if (turn.thinkingSummaryEl) turn.thinkingSummaryEl.textContent = '💭 思考过程';
                    if (turn.thinkingContentEl) turn.thinkingContentEl.textContent = ex.reasoning;
                }
                turn.bodyEl.innerHTML = `<div>${formatSimpleMarkdown(ex.assistantReply || '')}</div>`;
                turn.bodyEl.setAttribute('data-agy-katex-rendered', 'true');
            }
        }
    }

    /**
     * 执行中转模型无缝实时流式直连对话（支持高清原图多模态解析 + 本地文件/终端/CDP 工具调用 + 实时状态与思考过程 + 流式渲染）
     */
    async function executeDirectCustomChat(promptText, editorEl, preExtractedImages = null) {
        if (state.isSendingCustomChat || nativeCreation) return;
        const activeModel = getActiveModelObj();
        if (!activeModel) {
            openModelManagerModal();
            return;
        }

        const composerBox = editorEl ? findComposerBox(editorEl) : null;
        const images = Array.isArray(preExtractedImages)
            ? preExtractedImages
            : extractComposerImages(composerBox);

        const cleanPrompt = stripBridgeMarkers(promptText) || (images.length > 0 ? '[附带截图]' : '');
        if (!cleanPrompt && images.length === 0) return;

        let cid;
        try { cid = await ensureNativeConversation(cleanPrompt); }
        catch (error) { showError(error.message); return; }
        editorEl = document.querySelector('div[data-lexical-editor="true"][contenteditable="true"]') || editorEl;
        const uiTurn = renderCustomTurnInChatLog(cleanPrompt, activeModel, editorEl, '', true, images);
        if (!uiTurn) { showError('当前页面的聊天区域尚未就绪，请稍后重试'); return; }
        state.isSendingCustomChat = true;
        activeChatController = new AbortController();
        activeChatConversationId = cid;
        const chatController = activeChatController;
        let completed = false;
        if (!window.location.pathname.startsWith('/c/')) {
            state.activeLocalSessionId = cid;
            try { sessionStorage.setItem('agy-ms-local-session', cid); } catch {}
        }
        clearSubmittedComposer(editorEl);
        const stopButton = document.createElement('button');
        stopButton.type = 'button';
        stopButton.className = 'agy-ms-btn';
        stopButton.textContent = '停止生成';
        stopButton.addEventListener('click', () => chatController.abort(new Error('已停止生成')));
        uiTurn.statusWrapEl.appendChild(stopButton);
        const startedAt = Date.now();

        let currentPhaseMsg = images.length > 0
            ? `正在发送 ${images.length} 张高清原图并连接 ${activeModel.name}...`
            : `正在连接中转站 API (${activeModel.name})...`;
        let accumulatedThinking = '';
        let accumulatedReply = '';
        let executedToolCount = 0;
        let renderScheduled = false;
        let renderTimer;
        const progress = { startedAt, lastContentAt: startedAt, phase: 'connecting', thinkingLength: 0, replyLength: 0, monitor: null };
        let statusElement = null;
        if (uiTurn.nativeExchange) {
            statusElement = document.createElement('div');
            statusElement.setAttribute('data-testid', 'relay-run-status');
            statusElement.setAttribute(SKIP_I18N_ATTR, 'true');
            statusElement.setAttribute('data-agy-conversation-id', cid);
            statusElement.className = 'text-xs text-muted-foreground px-2 py-1';
            statusElement.style.cssText = 'line-height:1.5;overflow-wrap:anywhere;';
            statusElement.appendChild(uiTurn.statusTextEl);
            activeRunStatus = { cid, element: statusElement, progress };
            syncRunStatus();
        }

        const updateLiveStatusDisplay = () => {
            if (!uiTurn || !uiTurn.statusTextEl) return;
            progress.message = currentPhaseMsg;
            progress.thinkingLength = accumulatedThinking.length;
            progress.replyLength = accumulatedReply.length;
            const display = formatRunStatus(progress);
            if (uiTurn.statusTextEl.textContent !== display.text) uiTurn.statusTextEl.textContent = display.text;
            if (uiTurn.nativeExchange && uiTurn.nativeExchange.phase !== display.phase) {
                uiTurn.nativeExchange.phase = display.phase;
                syncNativeConversation();
            }
            syncRunStatus();
        };

        const statusInterval = setInterval(updateLiveStatusDisplay, 1000);
        updateLiveStatusDisplay();

        const scheduleStreamingBodyRender = (isFinal = false) => {
            if (!uiTurn || !uiTurn.bodyEl) return;
            if (isFinal) {
                clearTimeout(renderTimer);
                renderScheduled = false;
                if (uiTurn.nativeExchange) {
                    Object.assign(uiTurn.nativeExchange, { assistantReply: accumulatedReply, reasoning: accumulatedThinking, running: false, latencyMs: Date.now() - startedAt });
                    syncNativeConversation();
                }
                uiTurn.bodyEl.innerHTML = `<div>${formatSimpleMarkdown(accumulatedReply || '')}</div>`;
                uiTurn.bodyEl.setAttribute('data-agy-katex-rendered', 'true');
                return;
            }
            if (renderScheduled) return;
            renderScheduled = true;
            renderTimer = setTimeout(() => {
                renderScheduled = false;
                if (disposed || !uiTurn || !uiTurn.bodyEl || !state.isSendingCustomChat) return;
                if (uiTurn.nativeExchange) {
                    Object.assign(uiTurn.nativeExchange, { assistantReply: accumulatedReply, reasoning: accumulatedThinking });
                    syncNativeConversation();
                    return;
                }
                let scrollBox = uiTurn.wrapper.parentElement;
                while (scrollBox && !/(auto|scroll)/.test(getComputedStyle(scrollBox).overflowY)) scrollBox = scrollBox.parentElement;
                const follow = scrollBox && scrollBox.scrollHeight - scrollBox.scrollTop - scrollBox.clientHeight < 96;
                const rendered = formatSimpleMarkdown(accumulatedReply || '');
                uiTurn.bodyEl.innerHTML = `<div>${rendered}<span class="agy-ms-stream-cursor">▍</span></div>`;
                if (follow) scrollBox.scrollTop = scrollBox.scrollHeight;
            }, 60);
        };

        let streamReader = null;
        let idleTimer;
        const resetIdleTimeout = () => {
            clearTimeout(idleTimer);
            idleTimer = setTimeout(() => chatController.abort(new Error('连接长时间未返回数据，请重试')), 150000);
        };
        resetIdleTimeout();
        try {
            const res = await fetch(`${API_BASE}/chat/stream`, {
                method: 'POST',
                signal: chatController.signal,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    modelId: activeModel.id,
                    reasoningEffort: activeModel.reasoningEffort || 'default',
                    prompt: cleanPrompt,
                    images,
                    conversationId: cid,
                    includeHistory: true,
                    enableTools: true
                })
            });

            if (!res.ok || !res.body) {
                throw new Error(`HTTP ${res.status} ${res.statusText}`);
            }

            const reader = streamReader = res.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let sseBuffer = '';
            let currentEvent = 'message';
            let eventData = [];
            let handledFinal = false;

            const handleSsePacket = (evtName, rawData) => {
                if (!rawData) return;
                let data;
                try {
                    data = JSON.parse(rawData);
                } catch {
                    return;
                }

                if (evtName === 'activity') {
                    if (Number.isFinite(data.providerIdleMs) && Number.isFinite(data.contentIdleMs) && Number.isFinite(data.timeoutMs)) {
                        progress.monitor = { ...data, receivedAt: Date.now() };
                        progress.lastContentAt = Math.max(progress.lastContentAt, Date.now() - data.contentIdleMs);
                        if (data.phase) progress.phase = data.phase;
                        updateLiveStatusDisplay();
                    }
                } else if (evtName === 'status') {
                    if (data.phase) progress.phase = data.phase;
                    if (data.message) {
                        currentPhaseMsg = data.message;
                        updateLiveStatusDisplay();
                    }
                } else if (evtName === 'tool_start') {
                    progress.phase = 'tool';
                    currentPhaseMsg = `正在执行工具：${data.title || data.name || '工具'}`;
                    updateLiveStatusDisplay();
                    if (uiTurn.nativeExchange) {
                        uiTurn.nativeExchange.toolSteps.push({ ...data, running: true });
                        syncNativeConversation();
                    }
                    if (uiTurn && uiTurn.toolStepsEl) {
                        upsertToolStepCard(uiTurn.toolStepsEl, data, true);
                        uiTurn.wrapper.scrollIntoView({ behavior: 'auto', block: 'nearest' });
                    }
                } else if (evtName === 'tool_end') {
                    progress.phase = 'connecting';
                    progress.lastContentAt = Date.now();
                    updateLiveStatusDisplay();
                    if (uiTurn.nativeExchange) {
                        const tools = uiTurn.nativeExchange.toolSteps;
                        const index = tools.findIndex(tool => tool.id === data.id);
                        if (index >= 0) tools[index] = { ...tools[index], ...data, running: false };
                        else tools.push({ ...data, running: false });
                        syncNativeConversation();
                    }
                    executedToolCount++;
                    if (uiTurn && uiTurn.toolStepsEl) {
                        upsertToolStepCard(uiTurn.toolStepsEl, data, false);
                        uiTurn.wrapper.scrollIntoView({ behavior: 'auto', block: 'nearest' });
                    }
                } else if (evtName === 'thinking_delta') {
                    const delta = data.delta || '';
                    if (delta) {
                        progress.phase = 'thinking';
                        progress.lastContentAt = Date.now();
                        accumulatedThinking += delta;
                        currentPhaseMsg = `💭 ${activeModel.name} 正在深度思考... (已思考 ${accumulatedThinking.length} 字)`;
                        updateLiveStatusDisplay();
                        scheduleStreamingBodyRender(false);
                        if (uiTurn && uiTurn.thinkingWrapEl) {
                            uiTurn.thinkingWrapEl.style.display = 'block';
                            if (uiTurn.thinkingSummaryEl) {
                                uiTurn.thinkingSummaryEl.textContent = `💭 正在深度思考... (${accumulatedThinking.length} 字)`;
                            }
                            if (uiTurn.thinkingContentEl) {
                                uiTurn.thinkingContentEl.textContent = accumulatedThinking;
                                uiTurn.thinkingContentEl.scrollTop = uiTurn.thinkingContentEl.scrollHeight;
                            }
                        }
                    }
                } else if (evtName === 'text_delta') {
                    const delta = data.delta || '';
                    if (delta) {
                        progress.phase = 'streaming';
                        progress.lastContentAt = Date.now();
                        if (accumulatedReply.length === 0 && accumulatedThinking.length > 0 && uiTurn?.thinkingDetailsEl) {
                            uiTurn.thinkingDetailsEl.open = false;
                            if (uiTurn.thinkingSummaryEl) {
                                uiTurn.thinkingSummaryEl.textContent = `💭 思考过程 (${accumulatedThinking.length} 字 · 点击展开)`;
                            }
                        }
                        accumulatedReply += delta;
                        currentPhaseMsg = `✍️ ${activeModel.name} 正在实时生成回复... (已输出 ${accumulatedReply.length} 字)`;
                        updateLiveStatusDisplay();
                        scheduleStreamingBodyRender(false);
                    }
                } else if (evtName === 'checkpoint') {
                    if (data.exchangeId && uiTurn) uiTurn.wrapper.setAttribute('data-agy-exchange-id', data.exchangeId);
                    if (data.exchangeId && uiTurn?.nativeExchange) {
                        const exchange = uiTurn.nativeExchange;
                        const identity = nativeRenderIds.get(`${cid}:${exchange.id}`) || { id: exchange.id, createdAt: exchange.createdAt };
                        nativeRenderIds.set(`${cid}:${data.exchangeId}`, identity);
                        exchange.id = data.exchangeId;
                    }
                } else if (evtName === 'done') {
                    if(uiTurn.nativeExchange)uiTurn.nativeExchange.usage=data.usage||data.exchange?.usage||null;
                    handledFinal = true;
                    completed = true;
                    if (typeof data.reply === 'string') {
                        accumulatedReply = data.reply;
                    }
                    if (typeof data.reasoning === 'string') {
                        accumulatedThinking = data.reasoning;
                    }
                    const context = nativeContext();
                    const summary = context.summaries?.getState()?.summaries?.[cid];
                    if (summary) {
                        context.summaries.pushUpdate({ type: 'updateLastUserPromptTime', cascadeId: cid, time: new Date() });
                        context.service.writeSummary({ cascadeId: cid, summary: { ...summary, lastModifiedTime: nativeTimestamp(), lastUserInputTime: nativeTimestamp() } }).catch(error => {
                            if (!deletedConversations.has(cid)) showError(`会话时间更新失败：${error.message}`);
                        });
                    }
                    if (uiTurn) {
                        if (uiTurn.statusWrapEl) {
                            uiTurn.statusWrapEl.style.display = 'none';
                        }
                        if (data.exchangeId) {
                            uiTurn.wrapper.setAttribute('data-agy-exchange-id', data.exchangeId);
                            if (uiTurn.nativeExchange) {
                                const identity = nativeRenderIds.get(`${cid}:${uiTurn.nativeExchange.id}`) || { id: uiTurn.nativeExchange.id, createdAt: uiTurn.nativeExchange.createdAt };
                                nativeRenderIds.set(`${cid}:${data.exchangeId}`, identity);
                                uiTurn.nativeExchange.id = data.exchangeId;
                                if (Array.isArray(data.toolSteps)) uiTurn.nativeExchange.toolSteps = data.toolSteps;
                            }
                        }
                        if (Array.isArray(data.toolSteps) && data.toolSteps.length > 0 && uiTurn.toolStepsEl) {
                            data.toolSteps.forEach(st => upsertToolStepCard(uiTurn.toolStepsEl, st, false));
                            executedToolCount = data.toolSteps.length;
                        }
                        if (accumulatedThinking && uiTurn.thinkingWrapEl) {
                            uiTurn.thinkingWrapEl.style.display = 'block';
                            if (uiTurn.thinkingDetailsEl) uiTurn.thinkingDetailsEl.open = false;
                            if (uiTurn.thinkingSummaryEl) {
                                uiTurn.thinkingSummaryEl.textContent = `💭 思考过程 (${accumulatedThinking.length} 字)`;
                            }
                            if (uiTurn.thinkingContentEl) {
                                uiTurn.thinkingContentEl.textContent = accumulatedThinking;
                            }
                        }
                        const imgBadge = images.length > 0 ? ` · 🖼️ 含 ${images.length} 张原图` : '';
                        const toolBadge = executedToolCount > 0 ? ` · 🛠️ 调用 ${executedToolCount} 项工具` : '';
                        uiTurn.metaEl.textContent = `⚡ ${activeModel.name} · ${(data.protocol || 'API').toUpperCase()} 流式直连${imgBadge}${toolBadge} · ${data.latencyMs || (Date.now() - startedAt)}ms`;
                        scheduleStreamingBodyRender(true);
                        uiTurn.wrapper.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    }
                } else if (evtName === 'error') {
                    handledFinal = true;
                    throw new Error(data.error || '中转 API 请求失败');
                }
            };

            const processLine = line => {
                if (handledFinal) return;
                if (line === '') {
                    if (eventData.length) handleSsePacket(currentEvent, eventData.join('\n'));
                    currentEvent = 'message';
                    eventData = [];
                } else if (line.startsWith('event:')) {
                    currentEvent = line.slice(6).trim();
                } else if (line.startsWith('data:')) {
                    eventData.push(line.slice(5).replace(/^ /, ''));
                }
            };
            while (!handledFinal) {
                const { done, value } = await reader.read();
                resetIdleTimeout();
                sseBuffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
                const lines = sseBuffer.split(/\r?\n/);
                sseBuffer = lines.pop() || '';
                for (const line of lines) processLine(line);
                if (done) { if (sseBuffer) processLine(sseBuffer); processLine(''); break; }
            }

            if (!handledFinal) throw new Error('连接中断，回复尚未完成，请重试');
        } catch (err) {
            if (uiTurn) {
                if (uiTurn.statusWrapEl) uiTurn.statusWrapEl.style.display = 'none';
                const message = chatController.signal.aborted ? (chatController.signal.reason?.message || '已停止生成') : (err.message || String(err));
                if (uiTurn.nativeExchange) {
                    Object.assign(uiTurn.nativeExchange, { assistantReply: accumulatedReply, reasoning: accumulatedThinking, running: false, error: message });
                    syncNativeConversation();
                }
                uiTurn.metaEl.textContent = `⚠️ ${message}`;
                uiTurn.bodyEl.innerHTML = `<div>${formatSimpleMarkdown(accumulatedReply)}</div><p style="color:#dc2626;">${escapeHtml(message)}</p>`;
                uiTurn.bodyEl.setAttribute('data-agy-katex-rendered', 'true');
                if (!completed && editorEl?.isConnected && getActiveConversationId() === cid && !(editorEl.textContent || '').trim()) {
                    appendTextToLexicalEditor(editorEl, cleanPrompt);
                }
            }
        } finally {
            statusElement?.remove();
            if (activeRunStatus?.element === statusElement) activeRunStatus = null;
            clearInterval(statusInterval);
            clearTimeout(renderTimer);
            clearTimeout(idleTimer);
            if (streamReader) {
                try { await streamReader.cancel(); } catch {}
                try { streamReader.releaseLock(); } catch {}
            }
            stopButton.remove();
            if (activeChatController === chatController) { activeChatController = null; activeChatConversationId = null; }
            state.isSendingCustomChat = false;
            if (!disposed) await refreshState();
            if (completed && uiTurn?.nativeExchange && state.bridge?.conversationId === cid &&
                state.bridge.exchanges?.some(exchange => exchange.id === uiTurn.nativeExchange.id && exchange.assistantReply === accumulatedReply)) {
                for (const [key, exchange] of liveNativeTurns) if (exchange === uiTurn.nativeExchange) liveNativeTurns.delete(key);
                if (!disposed) syncNativeConversation();
            }
        }
    }

    /**
     * 渲染 Markdown 与 LaTeX 数学公式（调用 Antigravity 内置 window.katex 引擎，支持 $$...$$、\[...\]、$...$、\(...\)）
     */
    function formatSimpleMarkdown(text) {
        const rawText = String(text || '').replace(/\r\n/g, '\n');
        const placeholders = [];
        const putPlaceholder = (html) => {
            const idx = placeholders.length;
            placeholders.push(html);
            return `\u0000AGY_PH_${idx}\u0000`;
        };

        const renderTex = (tex, displayMode) => {
            const trimmed = String(tex || '').trim();
            if (!trimmed) return '';
            if (window.katex && typeof window.katex.renderToString === 'function') {
                try {
                    const html = window.katex.renderToString(trimmed, {
                        displayMode: !!displayMode,
                        throwOnError: false,
                        strict: 'ignore'
                    });
                    return displayMode
                        ? `<div class="agy-ms-math-display my-2 overflow-x-auto">${html}</div>`
                        : `<span class="agy-ms-math-inline">${html}</span>`;
                } catch {
                    // fallback below
                }
            }
            return displayMode
                ? `<div class="agy-ms-math-display my-2"><code>$$${escapeHtml(trimmed)}$$</code></div>`
                : `<code>$${escapeHtml(trimmed)}$</code>`;
        };

        // 1. 提取代码块，避免内部 $ 或 Markdown 符号被误解析
        let work = rawText.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
            const cleanCode = code.replace(/\n$/, '');
            return putPlaceholder(`<pre><code class="lang-${escapeHtml(lang)}">${escapeHtml(cleanCode)}</code></pre>`);
        });

        // 2. 提取行内代码 `...`
        work = work.replace(/`([^`\n]+)`/g, (_, code) => {
            return putPlaceholder(`<code>${escapeHtml(code)}</code>`);
        });

        // 3. 提取块级数学公式 $$...$$ 与 \[...\]
        work = work.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => putPlaceholder(renderTex(tex, true)));
        work = work.replace(/\\\[([\s\S]+?)\\\]/g, (_, tex) => putPlaceholder(renderTex(tex, true)));

        // 4. 提取行内数学公式 \(...\) 与 $...$
        work = work.replace(/\\\(([^\n]+?)\\\)/g, (_, tex) => putPlaceholder(renderTex(tex, false)));
        work = work.replace(/(?<!\\|\$)\$(?!\s)((?:\\.|[^$\n])+?)(?<!\s)\$(?!\$)/g, (_, tex) => {
            return putPlaceholder(renderTex(tex, false));
        });

        // 5. 转义常规文本 HTML 并处理行内 Markdown 语法
        let safe = escapeHtml(work);
        safe = safe.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
        safe = safe.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
        safe = safe.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
        safe = safe.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:#d97757;text-decoration:underline;">$1</a>');

        // 6. 处理段落、标题、列表、引用块
        const lines = safe.split('\n');
        const outBlocks = [];
        let inUl = false;
        let inOl = false;
        let paraLines = [];

        const flushPara = () => {
            if (paraLines.length > 0) {
                outBlocks.push(`<p>${paraLines.join('<br/>')}</p>`);
                paraLines = [];
            }
        };
        const closeLists = () => {
            if (inUl) { outBlocks.push('</ul>'); inUl = false; }
            if (inOl) { outBlocks.push('</ol>'); inOl = false; }
        };

        for (const rawLine of lines) {
            const trimmed = rawLine.trim();
            if (!trimmed) {
                flushPara();
                closeLists();
                continue;
            }
            if (/^\u0000AGY_PH_\d+\u0000$/.test(trimmed)) {
                flushPara();
                closeLists();
                outBlocks.push(trimmed);
                continue;
            }
            if (/^(?:---|\*\*\*|___)$/.test(trimmed)) {
                flushPara();
                closeLists();
                outBlocks.push('<hr style="border:none;border-top:1px solid var(--border, rgba(128,128,128,0.25));margin:10px 0;"/>');
                continue;
            }
            const hMatch = rawLine.match(/^\s*(#{1,4})\s+(.+)$/);
            if (hMatch) {
                flushPara();
                closeLists();
                const level = hMatch[1].length;
                outBlocks.push(`<h${level}>${hMatch[2]}</h${level}>`);
                continue;
            }
            const bqMatch = rawLine.match(/^\s*&gt;\s?(.*)$/);
            if (bqMatch) {
                flushPara();
                closeLists();
                outBlocks.push(`<blockquote>${bqMatch[1]}</blockquote>`);
                continue;
            }
            const ulMatch = rawLine.match(/^\s*[-*+]\s+(.+)$/);
            if (ulMatch) {
                flushPara();
                if (inOl) { outBlocks.push('</ol>'); inOl = false; }
                if (!inUl) { outBlocks.push('<ul>'); inUl = true; }
                outBlocks.push(`<li>${ulMatch[1]}</li>`);
                continue;
            }
            const olMatch = rawLine.match(/^\s*\d+\.\s+(.+)$/);
            if (olMatch) {
                flushPara();
                if (inUl) { outBlocks.push('</ul>'); inUl = false; }
                if (!inOl) { outBlocks.push('<ol>'); inOl = true; }
                outBlocks.push(`<li>${olMatch[1]}</li>`);
                continue;
            }
            closeLists();
            paraLines.push(rawLine);
        }
        flushPara();
        closeLists();

        let finalHtml = outBlocks.join('');
        finalHtml = finalHtml.replace(/\u0000AGY_PH_(\d+)\u0000/g, (_, idx) => placeholders[Number(idx)] || '');
        return finalHtml;
    }

    /**
     * 清理界面气泡中可能遗留的无缝桥接同步标记，让用户看到整洁的提问文本
     */
    function cleanBridgeMarkersInDOM() {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                return node.parentElement?.closest('[data-testid="user-input-step"]') &&
                    !node.parentElement?.closest('[contenteditable="true"], pre, code')
                    ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
            }
        });
        let node;
        while ((node = walker.nextNode())) {
            const val = node.nodeValue || '';
            if (val.includes('<!-- ANTIGRAVITY_BRIDGE_SYNC_START -->')) {
                const cleaned = stripBridgeMarkers(val);
                if (cleaned !== val) {
                    node.nodeValue = cleaned;
                }
            }
        }
    }

    /**
     * 统一处理聊天框消息提交（支持 Lexical Enter 最高优先级拦截与点击发送按钮两种方式）
     * 切回官方时仅在提交前附带待同步记录；官方 transcript 确认后再标记同步。
     */
    function handleOutgoingComposerSubmit(e, editorEl) {
        if (replayingOfficial) return false;
        const blockEvent = () => {
            e?.preventDefault?.();
            e?.stopPropagation?.();
            e?.stopImmediatePropagation?.();
        };
        if (selectionPending || bridgingOfficial || state.isSendingCustomChat) {
            blockEvent();
            return true;
        }
        const composerBox = editorEl ? findComposerBox(editorEl) : null;
        const rawPrompt = stripBridgeMarkers(editorEl ? (editorEl.textContent || '') : '');
        const attachedImages = extractComposerImages(composerBox);

        if (!rawPrompt && attachedImages.length === 0) return false;

        // 仅当选中的是【自定义中转模型】时拦截并直接发送给中转站 API（不经过官方 Gemini，也不篡改输入框内容）
        if (state.activeMode === 'custom' && getActiveModelObj()) {
            if (e) {
                if (typeof e.preventDefault === 'function') e.preventDefault();
                if (typeof e.stopPropagation === 'function') e.stopPropagation();
                if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
            }
            executeDirectCustomChat(rawPrompt, editorEl, attachedImages);
            return true;
        }

        const cid = getActiveConversationId();
        if (state.bridge?.conversationId === cid && state.bridge.unsyncedCustomCount > 0 &&
            !(editorEl.textContent || '').includes('ANTIGRAVITY_BRIDGE_SYNC_START')) {
            blockEvent();
            bridgingOfficial = true;
            (async () => {
                try {
                    const result = await apiFetch('/bridge/consume', {
                        method: 'POST', body: { conversationId: cid, markAsSynced: false }
                    });
                    if (disposed || !editorEl.isConnected || getActiveConversationId() !== cid ||
                        state.activeMode !== 'official' || selectionPending || stripBridgeMarkers(editorEl.textContent || '') !== rawPrompt) {
                        throw new Error('会话或输入内容已变化，请重新发送');
                    }
                    if (result.bridgeBlock) {
                        if (!appendTextToLexicalEditor(editorEl, result.bridgeBlock)) throw new Error('未能附带上下文，请重新发送');
                        await new Promise(resolve => setTimeout(resolve, 0));
                        if (!(editorEl.textContent || '').includes('ANTIGRAVITY_BRIDGE_SYNC_END')) throw new Error('编辑器上下文尚未就绪，请重新发送');
                    }
                    const sendButton = composerBox?.querySelector('button[data-testid="send-button"], button[aria-label="Send message"], button[aria-label="发送消息"]');
                    if (!sendButton || sendButton.disabled) throw new Error('发送按钮尚未就绪，请重新发送');
                    replayingOfficial = true;
                    try { sendButton.click(); } finally { replayingOfficial = false; }
                } catch (err) {
                    if (!disposed) showError(`官方模型上下文衔接失败：${err.message}`);
                } finally { bridgingOfficial = false; }
            })();
            return true;
        }

        return false;
    }

    function findComposerBox(startEl) {
        let cur = startEl;
        for (let i = 0; i < 8 && cur && cur !== document.body; i++) {
            if (
                cur.querySelector &&
                cur.querySelector('button[data-testid="model-selector-trigger"]') &&
                cur.querySelector('div[data-lexical-editor="true"][contenteditable="true"]')
            ) {
                return cur;
            }
            cur = cur.parentElement;
        }
        return null;
    }

    /**
     * 在 Lexical 编辑器实例上注册最高优先级 (COMMAND_PRIORITY_CRITICAL = 4) 的 KEY_ENTER_COMMAND 拦截器，
     * 确保按回车提交时 100% 优先于 Antigravity 原生提交逻辑执行，绝不误触发官方 Gemini 模型。
     */
    const hookedLexicalUnregisters = new Set();
    function bindLexicalEnterInterceptor() {
        const editors = document.querySelectorAll('div[data-lexical-editor="true"][contenteditable="true"]');
        editors.forEach((editorEl) => {
            const lex = editorEl.__lexicalEditor;
            if (!lex || lex.__agyCustomEnterHooked || !lex._commands) return;

            let enterCmd = null;
            for (const k of lex._commands.keys()) {
                if (k && k.type === 'KEY_ENTER_COMMAND') {
                    enterCmd = k;
                    break;
                }
            }
            if (!enterCmd || typeof lex.registerCommand !== 'function') return;

            const unregister = lex.registerCommand(
                enterCmd,
                (event) => {
                    if (event && (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.isComposing)) {
                        return false;
                    }
                    if (document.querySelector('[role="listbox"] [role="option"]')) {
                        return false;
                    }
                    if (!findComposerBox(editorEl)) return false;
                    return handleOutgoingComposerSubmit(event, editorEl);
                },
                4 // COMMAND_PRIORITY_CRITICAL
            );
            lex.__agyCustomEnterHooked = true;
            hookedLexicalUnregisters.add(() => {
                try { unregister(); } catch {}
                delete lex.__agyCustomEnterHooked;
            });
        });
    }

    function onGlobalKeyDown(e) {
        if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || e.isComposing) {
            return;
        }
        const target = e.target;
        if (!target || !(target instanceof HTMLElement)) return;
        const editorEl = target.closest('div[data-lexical-editor="true"][contenteditable="true"]');
        if (!editorEl) return;

        const composerBox = findComposerBox(editorEl);
        if (!composerBox) {
            return;
        }

        if (document.querySelector('[role="listbox"] [role="option"]')) {
            return;
        }

        handleOutgoingComposerSubmit(e, editorEl);
    }

    /**
     * 拦截输入框右下角【发送按钮】(`button[data-testid="send-button"]`) 的 pointerdown / mousedown / click 事件
     */
    function onGlobalSendButtonEvent(e) {
        if (e.type !== 'click') return;
        const target = e.target;
        if (!target || !(target instanceof Element)) return;
        const btn = target.closest('button');
        if (!btn) return;

        if (btn.getAttribute('data-testid') === 'model-selector-trigger' || btn.closest('.no-focus-agent-input')) {
            return;
        }

        const composerBox = findComposerBox(btn);
        if (!composerBox) return;

        const isSendBtn = btn.getAttribute('data-testid') === 'send-button' || btn.getAttribute('aria-label') === '发送消息' || btn.getAttribute('aria-label') === 'Send message';
        if (!isSendBtn) return;

        const editorEl = composerBox.querySelector('div[data-lexical-editor="true"][contenteditable="true"]');
        if (!editorEl) return;

        handleOutgoingComposerSubmit(e, editorEl);
    }

    function syncUsageDisplay() {
        let element=document.getElementById('agy-ms-usage');
        if(!window.__agySuiteSettings?.showUsage){element?.remove();return;}
        const composer=document.querySelector('[data-testid="agent-input-box"]');
        if(!composer)return;
        const exchanges=state.bridge.exchanges||[],last=exchanges.at(-1);
        if(!last){element?.remove();return;}
        if(!element){element=document.createElement('div');element.id='agy-ms-usage';element.setAttribute(SKIP_I18N_ATTR,'true');element.className='text-xs text-muted-foreground px-2 py-1';}
        if(element.parentElement!==composer)composer.appendChild(element);
        const known=exchanges.filter(ex=>ex.usage?.reportedRounds>0);
        const total=key=>known.reduce((sum,ex)=>sum+(ex.usage[key]||0),0);
        const number=value=>value===null||value===undefined?'—':value.toLocaleString();
        const usage=last.usage;
        const partial=exchanges.some(ex=>!ex.usage?.complete);
        const message=`Token：本轮输入 ${number(usage?.inputTokens)} / 输出 ${number(usage?.outputTokens)} · 会话累计输入 ${known.length?total('inputTokens').toLocaleString():'—'} / 输出 ${known.length?total('outputTokens').toLocaleString():'—'}${partial?'（部分请求未返回统计）':''}`;
        if(element.textContent!==message)element.textContent=message;
    }

    function syncAllUI() {
        if (disposed) return;
        syncRunStatus();
        syncUsageDisplay();
        const notice = document.getElementById('agy-ms-error-notice');
        if (notice && notice.getAttribute('data-agy-conversation-id') !== getActiveConversationId()) notice.remove();
        for (const cid of deletedConversations) {
            try {
                if (JSON.parse(localStorage.getItem('agy-ms-pending-deletes') || '[]').includes(cid)) persistNativeDeletion(cid).catch(() => {});
            } catch {}
        }
        injectSidebarNavEntry();
        syncComposerFooterUI();
        injectIntoNativeModelSelectorPanel();
        bindLexicalEnterInterceptor();
        cleanBridgeMarkersInDOM();
        syncPersistedCustomTurnsInChatLog();
        if (!legacyMigration && state.localSessions.length && nativeContext().service) {
            legacyMigration = (async () => {
                for (const session of state.localSessions.slice()) {
                    if (disposed || state.isSendingCustomChat || nativeCreation) break;
                    await createNativeConversation(session.title, session.conversationId);
                }
                await refreshState();
            })().catch(error => showError(`旧会话迁移失败：${error.message}`));
        }
    }

    // 启动监听
    function onNativeCancel(event) {
        if (!activeChatController || !event.target.closest('button[data-tooltip-id="input-send-button-cancel-tooltip"]')) return;
        event.preventDefault(); event.stopImmediatePropagation();
        activeChatController.abort(new Error('已停止生成'));
    }
    window.addEventListener('click', onNativeCancel, true);
    window.addEventListener('keydown', onGlobalKeyDown, true);
    window.addEventListener('pointerdown', onGlobalSendButtonEvent, true);
    window.addEventListener('mousedown', onGlobalSendButtonEvent, true);
    window.addEventListener('click', onGlobalSendButtonEvent, true);
    window.addEventListener('paste', onGlobalPaste, true);
    window.addEventListener('drop', onGlobalDrop, true);
    window.addEventListener('change', onGlobalFileInputChange, true);

    let syncTimerScheduled = false;
    const observer = new MutationObserver(() => {
        if (syncTimerScheduled) return;
        syncTimerScheduled = true;
        setTimeout(() => {
            if (disposed) return;
            syncTimerScheduled = false;
            try {
                injectSidebarNavEntry();
                if (document.querySelector('div[data-testid="model-selector-panel"]')) {
                    injectIntoNativeModelSelectorPanel();
                }
                syncComposerFooterUI();
                bindLexicalEnterInterceptor();
                cleanBridgeMarkersInDOM();
                // 仅在非活跃流式传输时同步持久化轮次，避免与 React 渲染冲突导致官方轮次消失
                if (!state.isSendingCustomChat) {
                    syncPersistedCustomTurnsInChatLog();
                }
            } catch {
                // ignore
            }
        }, 100);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const pollTimer = setInterval(refreshState, 4000);
    installNativeDeletionTracking();
    syncAllUI();
    refreshState();

    // 暴露全局调试与快捷调用接口
    window.__AGY_MODEL_SWITCHER = {
        revision: '2026-10-11.13',
        openModal: openModelManagerModal,
        refreshState,
        syncAllUI,
        formatSimpleMarkdown,
        formatRunStatus,
        getRunProgress: () => activeRunStatus?.progress || null,
        extractComposerImages,
        selectModel,
        getActiveConversationId,
        nativeContext,
        projectNativeState,
        retainNativePage,
        acceptNativePage,
        nativeLayout,
        ensureNativeConversation,
        stopGeneration: () => activeChatController?.abort(new Error('已停止生成')),
        getState: () => state
    };

    window.__AGY_MODEL_SWITCHER_CLEANUP = () => {
        document.getElementById('agy-ms-usage')?.remove();
        disposed = true;
        activeRunStatus?.element.remove();
        activeRunStatus = null;
        restoreNativeFetch();
        nativeAdapterCleanups.reverse().forEach(cleanup => cleanup());
        for (const entry of nativeOverlays.values()) {
            clearTimeout(entry.timer);
            entry.receive?.dispose?.();
            entry.provider.setState = entry.originalSet;
            entry.provider.requestPageUpdate = entry.originalRequest;
            entry.originalSet(entry.base);
        }
        nativeOverlays.clear();
        nativeRenderIds.clear();
        nativeHistoryByConversation.clear();
        activeChatController?.abort(new Error('切换器已重新加载'));
        nativeListenerCleanups.forEach(cleanup => cleanup());
        window.removeEventListener('click', onNativeCancel, true);
        window.removeEventListener('keydown', onGlobalKeyDown, true);
        window.removeEventListener('pointerdown', onGlobalSendButtonEvent, true);
        window.removeEventListener('mousedown', onGlobalSendButtonEvent, true);
        window.removeEventListener('click', onGlobalSendButtonEvent, true);
        window.removeEventListener('paste', onGlobalPaste, true);
        window.removeEventListener('drop', onGlobalDrop, true);
        window.removeEventListener('change', onGlobalFileInputChange, true);
        hookedLexicalUnregisters.forEach(fn => fn());
        hookedLexicalUnregisters.clear();
        observer.disconnect();
        clearInterval(pollTimer);
        document.getElementById('agy-model-manager-backdrop')?.remove();
        document.getElementById('agy-ms-error-notice')?.remove();
        document.querySelectorAll('.agy-ms-effort-submenu').forEach(el => el.remove());
        removeLegacyElements();
        const styleEl = document.getElementById('agy-model-switcher-styles');
        if (styleEl) styleEl.remove();
        document.querySelectorAll('button[data-agy-custom-api-nav="1"]').forEach(el => el.remove());
        document.querySelectorAll('div[data-agy-local-sessions="1"]').forEach(el => el.remove());
        document.querySelectorAll('[data-agy-bound-newchat]').forEach(el => el.removeAttribute('data-agy-bound-newchat'));
        document.querySelectorAll('[data-agy-bound-official]').forEach(el => el.removeAttribute('data-agy-bound-official'));
        document.querySelectorAll('[data-agy-custom-sig]').forEach(el => el.removeAttribute('data-agy-custom-sig'));
    };
})();

const number=value=>Number.isFinite(value)&&value>=0?value:null;
export function normalizeUsage(raw){
  if(!raw)return null;
  let input=number(raw.inputTokens??raw.prompt_tokens??raw.input_tokens),output=number(raw.outputTokens??raw.completion_tokens??raw.output_tokens);
  if(raw.input_tokens!==undefined&&input!==null)input+=(number(raw.cache_creation_input_tokens)||0)+(number(raw.cache_read_input_tokens)||0);
  if(input===null&&output===null)return null;
  return {inputTokens:input,outputTokens:output};
}
export function createUsageAccumulator(){
  let input=0,output=0,rounds=0,reported=0,inputReported=0,outputReported=0;
  return {add(raw){rounds++;const value=normalizeUsage(raw);if(value){reported++;if(value.inputTokens!==null){input+=value.inputTokens;inputReported++;}if(value.outputTokens!==null){output+=value.outputTokens;outputReported++;}}return this.value();},
    value(){return {inputTokens:inputReported?input:null,outputTokens:outputReported?output:null,reportedRounds:reported,totalRounds:rounds,complete:rounds>0&&inputReported===rounds&&outputReported===rounds};}};
}

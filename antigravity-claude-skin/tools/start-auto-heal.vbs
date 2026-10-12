Set fso = CreateObject("Scripting.FileSystemObject")
ToolsDir = fso.GetParentFolderName(WScript.ScriptFullName)
SkinRoot = fso.GetParentFolderName(ToolsDir)
DaemonJs = fso.BuildPath(ToolsDir, "auto-heal-daemon.js")

Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = SkinRoot
NodeBin = WshShell.ExpandEnvironmentStrings("%ProgramFiles%\nodejs\node.exe")
NodeFile = fso.BuildPath(fso.BuildPath(SkinRoot, "backup"), "node-bin.txt")
If fso.FileExists(NodeFile) Then
  Set reader = fso.OpenTextFile(NodeFile, 1, False, -1)
  NodeBin = Trim(reader.ReadAll)
  reader.Close
End If
If Not fso.FileExists(NodeBin) Then NodeBin = "node"
' Wait so Task Scheduler owns the guardian lifetime and can restart on failure.
WScript.Quit WshShell.Run("""" & NodeBin & """ """ & DaemonJs & """", 0, True)

' TouchLab launcher (run with wscript.exe so no console window appears).
' Starts the local server hidden if it is not already running, then opens the app
' in its own Edge app window (Chrome or the default browser as fallbacks).
Option Explicit

Dim sh, fso, appDir, url, port, i, node, edge, profile, args, logPath
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
port = "4747"
url = "http://127.0.0.1:" & port & "/"
logPath = appDir & "\logs\server.log"

Function Alive()
  On Error Resume Next
  Dim http
  Alive = False
  Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  http.setTimeouts 500, 500, 800, 800
  http.open "GET", url & "api/health", False
  http.send
  If Err.Number = 0 Then
    If http.status = 200 And InStr(http.responseText, """app"":""touchlab""") > 0 Then Alive = True
  End If
  Err.Clear
End Function

Function FirstExisting(paths)
  Dim p
  FirstExisting = ""
  For Each p In paths
    If fso.FileExists(p) Then
      FirstExisting = p
      Exit Function
    End If
  Next
End Function

If Not fso.FileExists(appDir & "\dist\index.html") Then
  MsgBox "TouchLab isn't built yet." & vbCrLf & vbCrLf & "Run Setup.cmd in " & appDir & " first.", vbExclamation, "TouchLab"
  WScript.Quit 1
End If

If Not Alive() Then
  node = FirstExisting(Array(sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs\node.exe", "C:\Program Files\nodejs\node.exe"))
  If node = "" Then node = "node"
  sh.CurrentDirectory = appDir
  sh.Run """" & node & """ """ & appDir & "\server.mjs""", 0, False
  For i = 1 To 60
    WScript.Sleep 250
    If Alive() Then Exit For
  Next
  If Not Alive() Then
    MsgBox "TouchLab's local server did not start." & vbCrLf & vbCrLf & _
      "Port " & port & " may be in use by another program, or Node.js is missing." & vbCrLf & _
      "Details: " & logPath, vbCritical, "TouchLab"
    WScript.Quit 1
  End If
End If

profile = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\TouchLab\EdgeProfile"
args = " --app=" & url & " --user-data-dir=""" & profile & """ --no-first-run --no-default-browser-check" & _
  " --window-size=1600,1000 --autoplay-policy=no-user-gesture-required" & _
  " --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows"

edge = FirstExisting(Array( _
  sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Microsoft\Edge\Application\msedge.exe", _
  sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\Microsoft\Edge\Application\msedge.exe", _
  sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\Google\Chrome\Application\chrome.exe", _
  sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Google\Chrome\Application\chrome.exe"))

If edge <> "" Then
  sh.Run """" & edge & """" & args, 1, False
Else
  sh.Run url, 1, False
End If

# James JMD — opens a .jmd by injecting it into the embedded runtime and launching the default browser.
# Needs nothing but Windows PowerShell (ships with Windows). Installed by install.cmd next to james-jmd.html.
param([Parameter(Mandatory = $true)][string]$Path)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$template = Get-Content -Raw -Encoding UTF8 (Join-Path $here 'james-jmd.html')
$src = Get-Content -Raw -Encoding UTF8 $Path
$src = $src -replace '</script', '<\/script'
$src = $src.TrimEnd("`r", "`n")
$name = [System.IO.Path]::GetFileName($Path) -replace '"', '&quot;'
$slug = [System.IO.Path]::GetFileNameWithoutExtension($Path)
$pattern = '(<script type="text/jmd" id="jmd")[^>]*>\r?\n?'
$html = [regex]::Replace($template, $pattern, { param($m) $m.Groups[1].Value + " data-name=""$name"">`n" + $src + "`n" }, 1)
$outDir = Join-Path $env:LOCALAPPDATA 'James JMD\decks'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$out = Join-Path $outDir "$slug.james-jmd.html"
[System.IO.File]::WriteAllText($out, $html, (New-Object System.Text.UTF8Encoding($false)))
Start-Process $out

function Find-MakeAppx {
    $sdkBin = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
    $makeAppx = Get-ChildItem -LiteralPath $sdkBin -Directory |
        Where-Object { $_.Name -match '^\d+(\.\d+){3}$' } |
        Sort-Object { [version] $_.Name } -Descending |
        ForEach-Object { Join-Path $_.FullName 'x64\makeappx.exe' } |
        Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
        Select-Object -First 1
    if (!$makeAppx) { throw 'Install the Windows SDK x64 MakeAppx tool.' }
    return $makeAppx
}

function New-MsixSource([string] $Executable, [string] $OutputDirectory) {
    $exe = (Resolve-Path -LiteralPath $Executable).Path
    $repository = Split-Path $PSScriptRoot
    $outputPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputDirectory)
    $output = [IO.Directory]::CreateDirectory($outputPath).FullName
    $stage = Join-Path $output 'package-source'
    if (Test-Path -LiteralPath $stage) { throw 'Choose a new MSIX output directory.' }
    $assets = [IO.Directory]::CreateDirectory((Join-Path $stage 'Assets')).FullName
    Copy-Item -LiteralPath $exe -Destination (Join-Path $stage 'AgentCouncil.exe')
    foreach ($icon in 'Square44x44Logo.png', 'Square150x150Logo.png', 'StoreLogo.png') {
        Copy-Item -LiteralPath (Join-Path $repository "src-tauri\icons\$icon") -Destination $assets
    }
    return @{ Output = $output; Stage = $stage }
}

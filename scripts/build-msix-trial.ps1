[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $Executable,
    [Parameter(Mandatory)] [string] $OutputDirectory
)

$ErrorActionPreference = 'Stop'
$exe = (Resolve-Path -LiteralPath $Executable).Path
$repository = Split-Path $PSScriptRoot
$sdkBin = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
$makeAppx = Get-ChildItem -LiteralPath $sdkBin -Directory |
    Where-Object { $_.Name -match '^\d+(\.\d+){3}$' } |
    Sort-Object { [version] $_.Name } -Descending |
    ForEach-Object { Join-Path $_.FullName 'x64\makeappx.exe' } |
    Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
    Select-Object -First 1
if (!$makeAppx) { throw 'Install the Windows SDK x64 MakeAppx tool.' }

$output = [IO.Directory]::CreateDirectory($ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputDirectory)).FullName
$stage = Join-Path $output 'package-source'
if (Test-Path -LiteralPath $stage) { throw 'Choose a new trial output directory.' }
$assets = [IO.Directory]::CreateDirectory((Join-Path $stage 'Assets')).FullName
Copy-Item -LiteralPath $exe -Destination (Join-Path $stage 'AgentCouncil.exe')
foreach ($icon in 'Square44x44Logo.png', 'Square150x150Logo.png', 'StoreLogo.png') {
    Copy-Item -LiteralPath (Join-Path $repository "src-tauri\icons\$icon") -Destination $assets
}
$launcher = Join-Path $output 'TrialLauncher.exe'
& rustc --edition=2024 --target x86_64-pc-windows-msvc (Join-Path $PSScriptRoot 'msix-trial-launcher.rs') -o $launcher
if ($LASTEXITCODE) { throw 'Could not build the isolated MSIX trial launcher.' }
Copy-Item -LiteralPath $launcher -Destination $stage

foreach ($version in '0.0.1.0', '0.0.2.0') {
    $manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
         xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
         xmlns:uap10="http://schemas.microsoft.com/appx/manifest/uap/windows10/10"
         xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
         IgnorableNamespaces="uap uap10 rescap">
  <Identity Name="AgentCouncil.CompatibilityTrial"
            Publisher="CN=Agent Council Compatibility Trial, OID.2.25.311729368913984317654407730594956997722=1"
            Version="$version" ProcessorArchitecture="x64" />
  <Properties>
    <DisplayName>Agent Council MSIX Trial</DisplayName>
    <PublisherDisplayName>Agent Council Compatibility Trial</PublisherDisplayName>
    <Logo>Assets\StoreLogo.png</Logo>
  </Properties>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.22000.0" MaxVersionTested="10.0.26100.0" />
  </Dependencies>
  <Resources><Resource Language="en-US" /></Resources>
  <Applications>
    <Application Id="Trial" Executable="TrialLauncher.exe" uap10:RuntimeBehavior="packagedClassicApp" uap10:TrustLevel="mediumIL">
      <uap:VisualElements DisplayName="Agent Council MSIX Trial" Description="Isolated Windows package compatibility trial"
                          BackgroundColor="transparent" Square150x150Logo="Assets\Square150x150Logo.png"
                          Square44x44Logo="Assets\Square44x44Logo.png" />
    </Application>
  </Applications>
  <Capabilities><rescap:Capability Name="runFullTrust" /></Capabilities>
</Package>
"@
    [IO.File]::WriteAllText((Join-Path $stage 'AppxManifest.xml'), $manifest)
    $package = Join-Path $output "AgentCouncil-MSIX-Trial-$version-x64.msix"
    if (Test-Path -LiteralPath $package) { throw "Package already exists: $package" }
    & $makeAppx pack /d $stage /p $package
    if ($LASTEXITCODE) { throw "MakeAppx could not build trial package $version." }
    Get-FileHash -LiteralPath $package -Algorithm SHA256
}

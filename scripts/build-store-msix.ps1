[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $Executable,
    [Parameter(Mandatory)] [string] $OutputDirectory,
    [version] $PackageVersion
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'msix-packaging.ps1')

$manifestPath = Join-Path (Split-Path $PSScriptRoot) 'packaging\windows\AppxManifest.xml'
$manifest = [xml] [IO.File]::ReadAllText($manifestPath)
if (!$PackageVersion) { $PackageVersion = [version] $manifest.Package.Identity.Version }
if ($PackageVersion.Major -le 0 -or $PackageVersion.Build -lt 0 -or $PackageVersion.Revision -ne 0 -or
    $PackageVersion.Major -gt 65535 -or $PackageVersion.Minor -gt 65535 -or $PackageVersion.Build -gt 65535) {
    throw 'Provide a four-part Store version with a nonzero major version and zero revision, such as 3.2.0.0.'
}
$manifest.Package.Identity.Version = $PackageVersion.ToString(4)

$exe = (Resolve-Path -LiteralPath $Executable).Path
$reader = [IO.BinaryReader]::new([IO.File]::OpenRead($exe))
try {
    if ($reader.BaseStream.Length -lt 64 -or $reader.ReadUInt16() -ne 0x5a4d) { throw 'Expected a Windows PE executable.' }
    $reader.BaseStream.Position = 0x3c
    $peOffset = $reader.ReadUInt32()
    if ($peOffset -gt ($reader.BaseStream.Length - 6)) { throw 'Invalid PE header offset.' }
    $reader.BaseStream.Position = $peOffset
    if ($reader.ReadUInt32() -ne 0x4550 -or $reader.ReadUInt16() -ne 0x8664) { throw 'Expected a Windows x64 executable.' }
} finally {
    $reader.Dispose()
}

$makeAppx = Find-MakeAppx
$source = New-MsixSource $exe $OutputDirectory
$manifest.Save((Join-Path $source.Stage 'AppxManifest.xml'))
$package = Join-Path $source.Output "AgentCouncil-Store-$PackageVersion-x64.msix"
if (Test-Path -LiteralPath $package) { throw "Package already exists: $package" }
& $makeAppx pack /d $source.Stage /p $package
if ($LASTEXITCODE) { throw 'MakeAppx could not build the Store candidate.' }
Get-FileHash -LiteralPath $package -Algorithm SHA256

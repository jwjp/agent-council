[CmdletBinding()]
param([Parameter(Mandatory)] [string] $PackageDirectory)

$ErrorActionPreference = 'Stop'
$directory = (Resolve-Path -LiteralPath $PackageDirectory).Path
$identity = 'AgentCouncil.CompatibilityTrial'
$registered = @(Get-AppxPackage -Name $identity)
if ($registered.Count) { throw 'An existing MSIX trial is installed. Use a fresh test environment.' }

Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class CouncilPackageIdentity {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern int GetPackageFullName(IntPtr process, ref uint length, StringBuilder name);

    public static string Get(IntPtr process) {
        uint length = 256;
        var name = new StringBuilder((int)length);
        int status = GetPackageFullName(process, ref length, name);
        if (status != 0) throw new System.ComponentModel.Win32Exception(status);
        return name.ToString();
    }
}
'@

function Assert-Trial([bool] $Condition, [string] $Message) {
    if (!$Condition) { throw $Message }
}

function Wait-Trial([string] $Label, [scriptblock] $Probe, [int] $Seconds = 35) {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    do {
        $value = & $Probe
        if ($value) { return $value }
        Start-Sleep -Milliseconds 250
    } while ($timer.Elapsed.TotalSeconds -lt $Seconds)
    throw "Timed out waiting for $Label."
}

function Install-Trial([string] $Version) {
    $path = Join-Path $directory "AgentCouncil-MSIX-Trial-$Version-x64.msix"
    Add-AppxPackage -Path $path -AllowUnsigned
    $package = Get-AppxPackage -Name $identity
    Assert-Trial ([string]$package.Version -eq $Version) "Package $Version was not registered."
    return $package
}

function Find-TrialProcesses($Package) {
    $path = Join-Path $Package.InstallLocation 'AgentCouncil.exe'
    Get-Process -Name AgentCouncil -ErrorAction SilentlyContinue | Where-Object Path -eq $path
}

function Start-Trial($Package) {
    Start-Process explorer.exe -ArgumentList "shell:AppsFolder\$($Package.PackageFamilyName)!Trial"
    $gui = Wait-Trial 'packaged GUI window' {
        Find-TrialProcesses $Package | Where-Object MainWindowHandle -ne 0 | Select-Object -First 1
    }
    Assert-Trial ([CouncilPackageIdentity]::Get($gui.Handle) -eq $Package.PackageFullName) 'GUI lacks the registered package identity.'
    return $gui
}

function Read-Runtime($Package, [string] $Data) {
    $runtime = Wait-Trial 'isolated runtime descriptor' {
        try {
            $value = Get-Content -Raw -LiteralPath (Join-Path $Data 'runtime.json') | ConvertFrom-Json
            if ([uri]::new($value.url).Host -eq '127.0.0.1' -and $value.version -eq '3.2.0-beta.3' -and $value.revision -eq 4) {
                $process = Find-TrialProcesses $Package | Where-Object Id -eq $value.pid
                if ($process) { $value }
            }
        } catch [System.Management.Automation.ItemNotFoundException] {
            return
        } catch [System.ArgumentException] {
            return
        }
    }
    $process = Get-Process -Id $runtime.pid
    Assert-Trial ([CouncilPackageIdentity]::Get($process.Handle) -eq $Package.PackageFullName) 'Host lacks the registered package identity.'
    return $runtime
}

function Invoke-TrialApi($Runtime, [string] $Path, [string] $Method = 'Get', $Body) {
    $request = @{
        Uri = $Runtime.url + '/v1' + $Path
        Method = $Method
        Headers = @{ Authorization = 'Bearer ' + $Runtime.token }
        TimeoutSec = 5
    }
    if ($null -ne $Body) {
        $request.ContentType = 'application/json'
        $request.Body = ConvertTo-Json -InputObject $Body -Depth 8 -Compress
    }
    Invoke-RestMethod @request
}

function Close-TrialWindow($Gui) {
    Assert-Trial ($Gui.CloseMainWindow()) 'Could not close the packaged GUI.'
    Assert-Trial ($Gui.WaitForExit(10000)) 'Packaged GUI did not close.'
}

$pkg = $null
$data = $null
try {
    $pkg = Install-Trial '0.0.1.0'
    $family = $pkg.PackageFamilyName
    $localState = Join-Path $env:LOCALAPPDATA "Packages\$family\LocalState"
    $data = [IO.Directory]::CreateDirectory((Join-Path $localState 'council')).FullName
    $bin = [IO.Directory]::CreateDirectory((Join-Path $localState 'fixture-bin')).FullName
    $project = [IO.Directory]::CreateDirectory((Join-Path $directory 'sample-project')).FullName
    $references = [IO.Directory]::CreateDirectory((Join-Path $directory 'reference')).FullName
    [IO.File]::WriteAllText((Join-Path $project 'main.rs'), "fixture line one`nfixture project line two`n")
    [IO.File]::WriteAllText((Join-Path $references 'reference.txt'), 'fixture reference')
    $fixture = Join-Path $directory 'fixture.exe'
    & rustc (Join-Path $PSScriptRoot 'fixture_agent.rs') -o $fixture
    if ($LASTEXITCODE) { throw 'Could not build the CLI fixture.' }
    foreach ($name in 'claude', 'codex', 'grok', 'agy', 'agent', 'cursor-agent', 'gemini') {
        Copy-Item -LiteralPath $fixture -Destination (Join-Path $bin "$name.exe")
    }
    $settings = @{
        folder = $project
        references = @($references)
        coder = 'claude'
        reviewers = @('codex', 'grok', 'agy', 'agent', 'gemini')
        permissions = 'restricted'
    }
    [IO.File]::WriteAllText((Join-Path $data 'settings.json'), ($settings | ConvertTo-Json -Compress))

    $gui = Start-Trial $pkg
    $runtime = Read-Runtime $pkg $data
    $health = Invoke-TrialApi $runtime '/health'
    Assert-Trial ($health.pid -eq $runtime.pid) 'Descriptor does not identify the responding host.'
    $null = Wait-Trial 'package-local WebView2 profile' {
        Test-Path -LiteralPath (Join-Path $localState 'webview\EBWebView') -PathType Container
    }
    Write-Host 'PASS MSIX registration, AppsFolder launch and packaged GUI/host identity'
    $update = Invoke-TrialApi $runtime '/update'
    Assert-Trial ($update.channel -eq 'windows-package' -and $update.available -eq $false -and $null -eq $update.asset -and $update.url -eq 'ms-windows-store://downloadsandupdates') 'Packaged host offered the wrong update channel.'
    Write-Host 'PASS package-local runtime and WebView2 data, Windows package update response'

    $state = Invoke-TrialApi $runtime '/state'
    Assert-Trial (@($state.agents | Where-Object installed).Count -eq 6) 'One or more of the six CLI adapters was not detected.'
    $preview = Invoke-TrialApi $runtime '/files/read' 'Post' @{ target = 'main.rs:2' }
    Assert-Trial ($preview.line -eq 2 -and $preview.text.Contains('fixture project line two')) 'Project file preview failed.'
    $preview = Invoke-TrialApi $runtime '/files/read' 'Post' @{ target = 'reference.txt' }
    Assert-Trial ($preview.text -eq 'fixture reference') 'Reference file preview failed.'
    $null = Invoke-TrialApi $runtime '/jobs' 'Post' @{ request = 'IMPLEMENT_REVIEW_FIX'; request_id = 'msix-trial-fixtures' }
    $state = Wait-Trial 'six-CLI workflow result' {
        $value = Invoke-TrialApi $runtime '/state'
        if ($value.job -and $value.job.status -ne 'running') { $value }
    }
    Assert-Trial ($state.job.status -eq 'done' -and @($state.activity | Where-Object kind -eq 'error').Count -eq 0) 'Packaged CLI workflow failed.'
    Assert-Trial (@($state.messages | Where-Object stage -eq 'review').Count -eq 5) 'Missing packaged reviewer output.'
    Assert-Trial ((Get-Content -Raw -LiteralPath (Join-Path $project 'fixture-implementation.txt')) -eq 'corrected') 'Packaged child could not modify the trial project.'
    Write-Host 'PASS six CLI fixtures, external project/reference reads and project write'

    $null = Invoke-TrialApi $runtime '/jobs' 'Post' @{ request = 'WAIT_FOR_CANCEL'; request_id = 'msix-trial-lifecycle' }
    $children = Wait-Trial 'active fixture process tree' {
        $path = Join-Path $project 'fixture-pids.txt'
        if (Test-Path -LiteralPath $path) { Get-Content -LiteralPath $path }
    }
    Assert-Trial (@($children).Count -eq 2) 'Fixture process tree marker is incomplete.'
    Close-TrialWindow $gui
    $running = Invoke-TrialApi $runtime '/state'
    Assert-Trial ($running.job.status -eq 'running') 'Closing the GUI interrupted active host work.'
    $gui = Start-Trial $pkg
    $reopened = Read-Runtime $pkg $data
    Assert-Trial ($reopened.pid -eq $runtime.pid) 'Reopened GUI did not reuse the running host.'
    $null = Invoke-TrialApi $runtime "/jobs/$($running.job.id)/cancel" 'Post' @{}
    $null = Wait-Trial 'cancelled CLI tree' {
        $value = Invoke-TrialApi $runtime '/state'
        if ($value.job.status -eq 'cancelled' -and !(Get-Process -Id ([int[]]$children) -ErrorAction SilentlyContinue)) { $true }
    }
    Write-Host 'PASS active job survives GUI close, reopen reuses host, cancel stops CLI tree'

    $null = Invoke-TrialApi $runtime '/draft' 'Put' @{ folder = $project; text = 'MSIX upgrade draft' }
    $before = Invoke-TrialApi $runtime '/state'
    Close-TrialWindow $gui
    Stop-Process -Id $runtime.pid
    $pkg = Install-Trial '0.0.2.0'
    Assert-Trial ($pkg.PackageFamilyName -eq $family) 'Upgrade unexpectedly changed the package family.'
    $gui = Start-Trial $pkg
    $runtime = Read-Runtime $pkg $data
    $after = Invoke-TrialApi $runtime '/state'
    Assert-Trial ($after.settings.folder -eq $project -and $after.draft -eq 'MSIX upgrade draft') 'Upgrade did not retain settings/draft.'
    Assert-Trial ($after.messages.Count -eq $before.messages.Count -and $after.job.id -eq $before.job.id) 'Upgrade did not retain history or job state.'
    Write-Host 'PASS idle MSIX version upgrade preserved the project, draft, history and job state'

    Close-TrialWindow $gui
    Stop-Process -Id $runtime.pid
    Remove-AppxPackage -Package $pkg.PackageFullName
    Assert-Trial (!(Get-AppxPackage -Name $identity)) 'Trial package remains registered after removal.'
    Assert-Trial ((Get-Content -Raw -LiteralPath (Join-Path $project 'fixture-implementation.txt')) -eq 'corrected') 'Uninstall altered the external project.'
    Write-Host 'PASS trial package removal preserves the external project'
} finally {
    $owned = Get-AppxPackage -Name $identity
    if ($owned) {
        Find-TrialProcesses $owned | Stop-Process -ErrorAction SilentlyContinue
        Remove-AppxPackage -Package $owned.PackageFullName -ErrorAction Continue
    }
}

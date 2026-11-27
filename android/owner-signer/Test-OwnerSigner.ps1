$ErrorActionPreference='Stop'
$tokens=$null; $parseErrors=$null
[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'OwnerSigner.ps1'),[ref]$tokens,[ref]$parseErrors) | Out-Null
if($parseErrors.Count -gt 0){throw ($parseErrors | Out-String)}
. (Join-Path $PSScriptRoot 'OwnerSigner.ps1') -FunctionsOnly
$script:checks=0
function Check([bool]$ok,[string]$message){$script:checks++;if(-not $ok){throw $message}}
$dir=Join-Path $env:TEMP ('owner-signer-test-'+[Guid]::NewGuid().ToString('N')); [IO.Directory]::CreateDirectory($dir) | Out-Null
try {
    $sample=Join-Path $dir 'data.bin'; [IO.File]::WriteAllBytes($sample,[Text.Encoding]::UTF8.GetBytes('abc'))
    Check-Hash $sample 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'; Check $true 'Hash accepted'
    $rejected=$false;try{Check-Hash $sample ('0'*64)}catch{$rejected=$true};Check $rejected 'Wrong digest rejected'
    Check (Inside (Join-Path $dir 'a\b') $dir) 'Child scope'
    Check (-not (Inside ($dir+'-other') $dir)) 'Sibling scope'
    $secret=ConvertTo-SecureString 'QA synthetic password only' -AsPlainText -Force
    $cipher=ConvertFrom-SecureString $secret
    Check (-not $cipher.Contains('QA synthetic password only')) 'DPAPI does not store plaintext'
    $round=ConvertTo-SecureString $cipher
    $env:VPS_OWNER_P12_PASS='previous-test-value'
    $value=With-Password $round { return $env:VPS_OWNER_P12_PASS }
    Check ($value -ceq 'QA synthetic password only') 'DPAPI roundtrip on Windows'
    Check ($env:VPS_OWNER_P12_PASS -ceq 'previous-test-value') 'Temporary environment restored'
    try{With-Password $round {throw 'synthetic failure'}}catch{}
    Check ($env:VPS_OWNER_P12_PASS -ceq 'previous-test-value') 'Environment restored on failure'
    Remove-Item Env:\VPS_OWNER_P12_PASS
    $secret.Dispose();$round.Dispose()
    $blocked=$false;try{Assert-OwnerHost}catch{$blocked=$true};Check $blocked 'Stable owner signing is blocked in CI'
    $private=Join-Path $dir 'private'; Private-Directory $private
    $acl=Get-Acl -LiteralPath $private
    Check $acl.AreAccessRulesProtected 'Private root inheritance disabled'
    Check ($acl.Access.Count -eq 2) 'Only owner and SYSTEM ACL entries'
    Check (-not (Test-Path (Join-Path $private 'release.p12'))) 'No real key generated'
    Write-Host ('PASS: Windows owner signer safeguards ('+$script:checks+' assertions); no owner key generated')
} finally { if(Test-Path -LiteralPath $dir){Remove-Item -LiteralPath $dir -Recurse -Force} }

[CmdletBinding()]
param([switch]$VerifyToolsOnly, [switch]$FunctionsOnly)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2

function Assert-OwnerHost {
    if ($env:GITHUB_ACTIONS -or $env:CI) { throw 'Owner signing/key operations are prohibited in CI.' }
    if ($env:OS -ne 'Windows_NT' -or -not [Environment]::Is64BitOperatingSystem) { throw 'Run on the owner Windows 10/11 x64 computer.' }
}
function Hash-File([string]$Path) { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Check-Hash([string]$Path, [string]$Expected) {
    if ($Expected -cnotmatch '^[a-f0-9]{64}$' -or -not (Test-Path -LiteralPath $Path -PathType Leaf) -or (Hash-File $Path) -cne $Expected) { throw 'SHA-256 check failed. Stop; do not replace the reviewed APK.' }
}
function Native([string]$Exe, [string[]]$Arguments) {
    $previous=$ErrorActionPreference
    try { $ErrorActionPreference='Continue'; $out = @(& $Exe @Arguments 2>&1); $exit=$LASTEXITCODE }
    finally { $ErrorActionPreference=$previous }
    if ($exit -ne 0) { throw "Signing tool failed: $([IO.Path]::GetFileName($Exe)); exit $exit. No password is logged." }
    return ($out -join "`n")
}
function Private-Directory([string]$Path) {
    [IO.Directory]::CreateDirectory($Path) | Out-Null
    if ((Get-Item -LiteralPath $Path).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Private directory cannot be a link.' }
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetOwner((New-Object Security.Principal.SecurityIdentifier($sid)))
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($id in @($sid, 'S-1-5-18')) {
        $rule = New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($id)), 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}
function Inside([string]$Child, [string]$Parent) {
    $separator=[IO.Path]::DirectorySeparatorChar
    $c = [IO.Path]::GetFullPath($Child).TrimEnd($separator) + $separator
    $p = [IO.Path]::GetFullPath($Parent).TrimEnd($separator) + $separator
    return $c.StartsWith($p, [StringComparison]::OrdinalIgnoreCase)
}
function Get-Tools([string]$Root) {
    [IO.Directory]::CreateDirectory($Root) | Out-Null
    $config = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'toolchain.json') -Raw | ConvertFrom-Json
    if ($config.schema -ne 1) { throw 'Unsupported toolchain manifest.' }
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $ProgressPreference = 'SilentlyContinue'
    $paths = @{}
    foreach ($name in @('jdk', 'buildtools')) {
        $item = $config.$name
        $u = [Uri]$item.url
        if ($u.Scheme -ne 'https' -or @('aka.ms','dl.google.com') -notcontains $u.Host -or $item.sha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'Untrusted toolchain source.' }
        $zip = Join-Path $Root ($name + '.zip')
        if (Test-Path -LiteralPath $zip) {
            try { Check-Hash $zip $item.sha256 } catch { Remove-Item -LiteralPath $zip -Force }
        }
        if (-not (Test-Path -LiteralPath $zip)) {
            Write-Host "Đang tải công cụ $name từ Microsoft/Google..."
            $part = $zip + '.part'
            try { Invoke-WebRequest -UseBasicParsing -Uri $item.url -OutFile $part -TimeoutSec 600; Check-Hash $part $item.sha256; Move-Item -LiteralPath $part -Destination $zip -Force }
            finally { if (Test-Path -LiteralPath $part) { Remove-Item -LiteralPath $part -Force } }
        }
        Check-Hash $zip $item.sha256
        $dest = Join-Path $Root $name
        # Always extract from verified archives, not a mutable marker in a previous install.
        if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }
        Expand-Archive -LiteralPath $zip -DestinationPath $dest
        if ($name -eq 'jdk') { $marker = @(Get-ChildItem -LiteralPath $dest -Filter keytool.exe -Recurse -File) }
        else { $marker = @(Get-ChildItem -LiteralPath $dest -Filter aapt2.exe -Recurse -File) }
        if ($marker.Count -ne 1) { throw 'Unexpected tool archive layout.' }
        $paths[$name] = Split-Path -Parent $marker[0].FullName
    }
    $paths.java = Join-Path $paths.jdk 'java.exe'
    $paths.keytool = Join-Path $paths.jdk 'keytool.exe'
    $paths.signer = Join-Path $paths.buildtools 'lib\apksigner.jar'
    $paths.aapt = Join-Path $paths.buildtools 'aapt2.exe'
    $paths.align = Join-Path $paths.buildtools 'zipalign.exe'
    Native $paths.java @('-version') | Out-Null
    Native $paths.aapt @('version') | Out-Null
    Native $paths.java @('-jar',$paths.signer,'version') | Out-Null
    return $paths
}
function Ask-Password([bool]$New, [string]$Alias) {
    $f = New-Object Windows.Forms.Form
    $f.Text = 'VPS Control — Khóa ký của anh'; $f.Width=480; $f.Height=310; $f.StartPosition='CenterScreen'; $f.FormBorderStyle='FixedDialog'; $f.MaximizeBox=$false
    $f.Font = New-Object Drawing.Font('Segoe UI',10)
    $label=New-Object Windows.Forms.Label; $label.Text= $(if($New){'Tạo mật khẩu cho khóa ký (ít nhất 14 ký tự). Lưu mật khẩu vào nơi riêng của anh.'}else{'Nhập mật khẩu khóa hiện có. Không gửi mật khẩu cho Hermes hoặc qua chat.'}); $label.SetBounds(20,15,420,55); $f.Controls.Add($label)
    $a=New-Object Windows.Forms.TextBox; $a.Text=$Alias; $a.SetBounds(20,80,420,28); $f.Controls.Add($a)
    $p=New-Object Windows.Forms.TextBox; $p.UseSystemPasswordChar=$true; $p.SetBounds(20,120,420,28); $f.Controls.Add($p)
    $q=New-Object Windows.Forms.TextBox; $q.UseSystemPasswordChar=$true; $q.SetBounds(20,160,420,28); $f.Controls.Add($q)
    $tip=New-Object Windows.Forms.Label; $tip.Text='Dòng đầu: tên khóa (alias). Hai dòng dưới: mật khẩu và nhập lại.'; $tip.SetBounds(20,193,420,28); $f.Controls.Add($tip)
    $ok=New-Object Windows.Forms.Button; $ok.Text='Tiếp tục'; $ok.SetBounds(225,230,105,30); $ok.DialogResult=[Windows.Forms.DialogResult]::OK; $f.Controls.Add($ok)
    $no=New-Object Windows.Forms.Button; $no.Text='Hủy'; $no.SetBounds(340,230,100,30); $no.DialogResult=[Windows.Forms.DialogResult]::Cancel; $f.Controls.Add($no); $f.AcceptButton=$ok; $f.CancelButton=$no
    try {
        if ($f.ShowDialog() -ne [Windows.Forms.DialogResult]::OK) { throw 'Owner cancelled.' }
        if ($a.Text -cnotmatch '^[a-zA-Z0-9_-]{1,64}$' -or $p.Text.Length -lt 14 -or $p.Text.Length -gt 128 -or $p.Text -cne $q.Text) { throw 'Alias/password invalid or confirmation differs. Run again.' }
        return @{ Alias=$a.Text; Secret=(ConvertTo-SecureString -String $p.Text -AsPlainText -Force) }
    } finally { $p.Clear(); $q.Clear(); $f.Dispose() }
}
function With-Password([Security.SecureString]$Secret, [scriptblock]$Body) {
    $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secret)
    $old=[Environment]::GetEnvironmentVariable('VPS_OWNER_P12_PASS','Process')
    try { $env:VPS_OWNER_P12_PASS=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr); & $Body }
    finally { [Environment]::SetEnvironmentVariable('VPS_OWNER_P12_PASS',$old,'Process'); [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
function Export-Cert($Tools, [string]$Key, [string]$Alias, [string]$Destination) {
    Native $Tools.keytool @('-exportcert','-keystore',$Key,'-alias',$Alias,'-storepass:env','VPS_OWNER_P12_PASS','-file',$Destination) | Out-Null
    return Hash-File $Destination
}
function Owner-Run {
    Assert-OwnerHost
    Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing
    $receipt=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'release-receipt.json') -Raw | ConvertFrom-Json
    if ($receipt.package -cne 'com.vpscontrol.widget' -or $receipt.versionName -cnotmatch '^\d+\.\d+\.\d+$' -or $receipt.unsignedFile -cnotmatch '^vps-control-v\d+\.\d+\.\d+-unsigned\.apk$') { throw 'Invalid release receipt.' }
    $apkInput=Join-Path $PSScriptRoot $receipt.unsignedFile
    Check-Hash $apkInput $receipt.unsignedSha256
    if ((Get-Item -LiteralPath $apkInput).Length -ne $receipt.unsignedSize) { throw 'APK size mismatch.' }
    $root=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'VPSControlSigner'
    Private-Directory $root
    $lock=$null; $secret=$null
    try {
        $lock=[IO.File]::Open((Join-Path $root 'signer.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
        $tools=Get-Tools (Join-Path $root 'tools')
        $badging=Native $tools.aapt @('dump','badging',$apkInput)
        $expected="package: name='com.vpscontrol.widget' versionCode='$($receipt.versionCode)' versionName='$($receipt.versionName)'"
        if (-not $badging.StartsWith($expected) -or $badging -notmatch "minSdkVersion:'29'" -or $badging -notmatch "targetSdkVersion:'35'") { throw 'Stable package/version/SDK mismatch.' }
        Native $tools.align @('-c','4',$apkInput) | Out-Null
        $keys=Join-Path $root 'keys'; Private-Directory $keys
        $key=Join-Path $keys 'release.p12'; $password=Join-Path $keys 'password.dpapi'; $identity=Join-Path $keys 'identity.json'; $alias='vps-control-release'
        $known=$null
        $new=-not (Test-Path -LiteralPath $key)
        if ($new -and ((Test-Path -LiteralPath $password) -or (Test-Path -LiteralPath $identity))) { throw 'Signing identity incomplete. Restore the original key; never generate a replacement.' }
        if ($new) {
            $choice=[Windows.Forms.MessageBox]::Show('Anh đã có khóa ký stable ở nơi khác chưa? Yes = chọn khóa P12 hiện có; No = tạo khóa đầu tiên trên máy này; Cancel = dừng.','VPS Control',[Windows.Forms.MessageBoxButtons]::YesNoCancel)
            if ($choice -eq [Windows.Forms.DialogResult]::Cancel) { throw 'Owner cancelled.' }
            $import=''
            if ($choice -eq [Windows.Forms.DialogResult]::Yes) {
                $pick=New-Object Windows.Forms.OpenFileDialog; $pick.Filter='Encrypted PKCS12 key (*.p12;*.pfx)|*.p12;*.pfx'; if($pick.ShowDialog() -ne [Windows.Forms.DialogResult]::OK){throw 'Owner cancelled.'}; $import=$pick.FileName; $pick.Dispose()
            }
            $answer=Ask-Password ($import -eq '') $alias; $secret=$answer.Secret; $alias=$answer.Alias
            With-Password $secret {
                if ($import) {
                    Native $tools.keytool @('-list','-storetype','PKCS12','-keystore',$import,'-alias',$alias,'-storepass:env','VPS_OWNER_P12_PASS') | Out-Null
                    [IO.File]::Copy($import,$key,$false)
                } else {
                    Native $tools.keytool @('-genkeypair','-keystore',$key,'-storetype','PKCS12','-storepass:env','VPS_OWNER_P12_PASS','-keypass:env','VPS_OWNER_P12_PASS','-alias',$alias,'-keyalg','RSA','-keysize','3072','-validity','10000','-dname','CN=VPS Control Release','-noprompt') | Out-Null
                }
            }
        } else {
            if (Test-Path -LiteralPath $identity) {
                $known=Get-Content -LiteralPath $identity -Raw | ConvertFrom-Json; $alias=$known.alias
                try { $secret=ConvertTo-SecureString ((Get-Content -LiteralPath $password -Raw).Trim()) }
                catch { $answer=Ask-Password $false $alias; if($answer.Alias -cne $alias){throw 'Original alias required.'}; $secret=$answer.Secret }
            } else {
                [Windows.Forms.MessageBox]::Show('Đã có file khóa từ lần chạy trước. Bộ thiết lập sẽ dùng lại khóa này, không tạo khóa thay thế. Nhập alias và mật khẩu gốc để tiếp tục.','VPS Control') | Out-Null
                $answer=Ask-Password $false $alias; $secret=$answer.Secret; $alias=$answer.Alias
            }
        }
        $public=Join-Path $root 'public-output'; [IO.Directory]::CreateDirectory($public) | Out-Null
        $cert=Join-Path $public 'release-certificate.der'
        $fingerprint=With-Password $secret { Export-Cert $tools $key $alias $cert }
        if ($known -and $fingerprint -cne $known.certSha256) { throw 'Stable certificate changed. Stop; no release will be produced.' }
        @{ alias=$alias; certSha256=$fingerprint; machine=$env:COMPUTERNAME; user=[Security.Principal.WindowsIdentity]::GetCurrent().Name } | ConvertTo-Json | Set-Content -LiteralPath $identity -Encoding UTF8
        (ConvertFrom-SecureString $secret) | Set-Content -LiteralPath $password -Encoding ASCII
        # Encrypted P12 backup is mandatory before signing. Password is never included in a handoff.
        $folder=New-Object Windows.Forms.FolderBrowserDialog; $folder.Description='Chọn nơi backup khóa đã mã hóa: USB/ổ ngoài hoặc thư mục cloud của anh. Nhớ giữ mật khẩu riêng.'
        if($folder.ShowDialog() -ne [Windows.Forms.DialogResult]::OK){throw 'Backup cancelled. Original key retained; no APK signed.'}; $backupRoot=$folder.SelectedPath; $folder.Dispose()
        if((Inside $backupRoot $root) -or (Inside $backupRoot $PSScriptRoot)){throw 'Choose a backup location outside the signer and handoff folders.'}
        $backup=Join-Path $backupRoot ('VPS-Control-stable-key-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[Guid]::NewGuid().ToString('N').Substring(0,6)+'.p12')
        [IO.File]::Copy($key,$backup,$false); Check-Hash $backup (Hash-File $key)
        $backupCert=Join-Path $keys 'backup-check.der'
        try { $restored=With-Password $secret { Export-Cert $tools $backup $alias $backupCert }; if($restored -cne $fingerprint){throw 'Backup certificate mismatch.'} }
        finally { if(Test-Path -LiteralPath $backupCert){Remove-Item -LiteralPath $backupCert -Force} }
        @{ alias=$alias; certSha256=$fingerprint; keyFile=[IO.Path]::GetFileName($backup); note='Encrypted P12. Retain the password separately; do not send this key to chat/GitHub/Hermes.' } | ConvertTo-Json | Set-Content -LiteralPath ($backup+'.json') -Encoding UTF8
        $output=Join-Path $public ('VPS-Control-Widget-'+$receipt.versionName+'.apk')
        With-Password $secret { Native $tools.java @('-jar',$tools.signer,'sign','--ks',$key,'--ks-key-alias',$alias,'--ks-pass','env:VPS_OWNER_P12_PASS','--key-pass','env:VPS_OWNER_P12_PASS','--out',$output,$apkInput) | Out-Null }
        $report=Native $tools.java @('-jar',$tools.signer,'verify','--verbose','--print-certs',$output)
        if($report -cnotmatch [regex]::Escape('certificate SHA-256 digest: '+$fingerprint)){throw 'Signed APK certificate mismatch.'}
        Native $tools.align @('-c','4',$output) | Out-Null
        if((Get-Item -LiteralPath $output).Length -gt 500000){throw 'APK exceeds reviewed size budget.'}
        $result=@{ source=$receipt.source; versionName=$receipt.versionName; versionCode=$receipt.versionCode; package=$receipt.package; unsignedSha256=$receipt.unsignedSha256; apkSha256=(Hash-File $output); apkBytes=(Get-Item -LiteralPath $output).Length; certSha256=$fingerprint; status='Owner signed; GitHub publishing still required' }
        $resultFile=Join-Path $public 'signed-release.json'; $result | ConvertTo-Json | Set-Content -LiteralPath $resultFile -Encoding UTF8
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $zip=Join-Path $PSScriptRoot 'KET-QUA-GUI-HERMES.zip'; $temp=Join-Path $public ([Guid]::NewGuid().ToString('N'))
        [IO.Directory]::CreateDirectory($temp) | Out-Null
        try {
            foreach($file in @($output,$cert,$resultFile)){[IO.File]::Copy($file,(Join-Path $temp ([IO.Path]::GetFileName($file))),$false)}
            if(Test-Path -LiteralPath $zip){Remove-Item -LiteralPath $zip -Force}
            [IO.Compression.ZipFile]::CreateFromDirectory($temp,$zip)
        } finally { Remove-Item -LiteralPath $temp -Recurse -Force }
        [Windows.Forms.MessageBox]::Show("Đã ký và kiểm tra xong. Gửi riêng file KET-QUA-GUI-HERMES.zip cho Hermes để đăng bản cập nhật. Khóa riêng không nằm trong file này.`n`nKhóa được giữ tại: $keys`nBackup mã hóa: $backup",'VPS Control') | Out-Null
        Start-Process explorer.exe -ArgumentList ('/select,"'+$zip+'"')
    } finally { if($secret){$secret.Dispose()}; if($lock){$lock.Dispose()} }
}
if ($FunctionsOnly) { return }
try {
    if($VerifyToolsOnly) {
        if($env:OS -ne 'Windows_NT'){throw 'Windows tool verification requires Windows.'}
        $folder=Join-Path $env:TEMP 'vps-owner-tool-verification'; [IO.Directory]::CreateDirectory($folder) | Out-Null
        $t=Get-Tools $folder
        Write-Host 'PASS: pinned Windows Java, keytool, aapt2 and apksigner execute. No owner key or signed APK generated.'
    } else { Owner-Run }
} catch {
    Write-Error $_.Exception.Message
    exit 1
}

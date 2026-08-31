function normalizeOrigin(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Installer origin must use HTTP or HTTPS");
  }
  return url.origin;
}

export function resolveInstallerOrigin(
  request: Request,
  configuredOrigin = process.env.ENACT_PUBLIC_URL ?? process.env.ENACT_APP_URL,
): string {
  if (configuredOrigin) {
    return normalizeOrigin(configuredOrigin);
  }

  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host");
  if (!host) {
    return normalizeOrigin(request.url);
  }

  const forwardedProtocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  const protocol = forwardedProtocol || new URL(request.url).protocol.replace(":", "");
  return normalizeOrigin(`${protocol}://${host}`);
}

export function buildUnixInstaller(rawOrigin: string): string {
  const origin = normalizeOrigin(rawOrigin);
  return [
    "#!/bin/sh",
    "set -eu",
    "",
    `origin='${origin}'`,
    'os="$(uname -s | tr \'[:upper:]\' \'[:lower:]\')"',
    'arch="$(uname -m)"',
    'case "$arch" in',
    '  x86_64|amd64) arch="amd64" ;;',
    '  arm64|aarch64) arch="arm64" ;;',
    '  *) echo "Unsupported architecture: $arch" >&2; exit 1 ;;',
    "esac",
    'case "$os" in',
    '  linux|darwin) ;;',
    '  *) echo "Unsupported operating system: $os" >&2; exit 1 ;;',
    "esac",
    'artifact="enact-cli-${os}-${arch}"',
    'install_dir="${ENACT_INSTALL_DIR:-$HOME/.local/bin}"',
    'tmp_dir="$(mktemp -d)"',
    'trap \'rm -rf "$tmp_dir"\' EXIT HUP INT TERM',
    'download() {',
    '  if command -v curl >/dev/null 2>&1; then',
    '    curl -fsSL "$1" -o "$2"',
    '  elif command -v wget >/dev/null 2>&1; then',
    '    wget -q "$1" -O "$2"',
    "  else",
    '    echo "curl or wget is required" >&2',
    "    exit 1",
    "  fi",
    "}",
    'download "$origin/downloads/$artifact" "$tmp_dir/enact"',
    'download "$origin/downloads/checksums.txt" "$tmp_dir/checksums.txt"',
    'expected="$(awk -v name="$artifact" \'$2 == name { print $1 }\' "$tmp_dir/checksums.txt")"',
    'if [ -z "$expected" ]; then',
    '  echo "No checksum published for $artifact" >&2',
    "  exit 1",
    "fi",
    'if command -v sha256sum >/dev/null 2>&1; then',
    '  actual="$(sha256sum "$tmp_dir/enact" | awk \'{ print $1 }\')"',
    'elif command -v shasum >/dev/null 2>&1; then',
    '  actual="$(shasum -a 256 "$tmp_dir/enact" | awk \'{ print $1 }\')"',
    "else",
    '  echo "sha256sum or shasum is required to verify the download" >&2',
    "  exit 1",
    "fi",
    'if [ "$actual" != "$expected" ]; then',
    '  echo "Checksum verification failed for $artifact" >&2',
    "  exit 1",
    "fi",
    'mkdir -p "$install_dir"',
    'chmod 0755 "$tmp_dir/enact"',
    'mv "$tmp_dir/enact" "$install_dir/enact"',
    'echo "Enact CLI installed to $install_dir/enact"',
    'case ":$PATH:" in',
    '  *":$install_dir:"*) ;;',
    '  *) echo "Add $install_dir to PATH, then open a new terminal." ;;',
    "esac",
    "",
  ].join("\n");
}

export function buildWindowsInstaller(rawOrigin: string): string {
  const origin = normalizeOrigin(rawOrigin);
  return [
    '$ErrorActionPreference = "Stop"',
    '$architecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }',
    '$arch = switch -Regex ($architecture) {',
    '  "^(AMD64|x86_64)$" { "amd64"; break }',
    '  "^(ARM64|aarch64)$" { "arm64"; break }',
    '  default { throw "Unsupported architecture: $architecture" }',
    "}",
    '$artifact = "enact-cli-windows-$arch.exe"',
    `$origin = '${origin}'`,
    '$downloadUrl = "$origin/downloads/$artifact"',
    '$checksumUrl = "$origin/downloads/checksums.txt"',
    '$installDir = Join-Path $env:USERPROFILE ".enact\\bin"',
    '$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("enact-install-" + [guid]::NewGuid().ToString("N"))',
    'New-Item -ItemType Directory -Path $tempDir -Force | Out-Null',
    "try {",
    '  $downloadPath = Join-Path $tempDir "enact.exe"',
    '  Invoke-WebRequest -UseBasicParsing -Uri $downloadUrl -OutFile $downloadPath',
    '  $checksums = (Invoke-WebRequest -UseBasicParsing -Uri $checksumUrl).Content',
    '  if ($checksums -is [byte[]]) { $checksums = [Text.Encoding]::UTF8.GetString($checksums) }',
    '  $line = ([string]$checksums -split "`r?`n") | Where-Object { $_ -match ("\\s" + [regex]::Escape($artifact) + "$") } | Select-Object -First 1',
    '  if (-not $line) { throw "No checksum published for $artifact" }',
    '  $expected = ($line -split "\\s+")[0].ToLowerInvariant()',
    '  $actual = (Get-FileHash -Path $downloadPath -Algorithm SHA256).Hash.ToLowerInvariant()',
    '  if ($actual -ne $expected) { throw "Checksum verification failed for $artifact" }',
    '  New-Item -ItemType Directory -Path $installDir -Force | Out-Null',
    '  Move-Item -Path $downloadPath -Destination (Join-Path $installDir "enact.exe") -Force',
    "} finally {",
    '  Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue',
    "}",
    '$userPath = [Environment]::GetEnvironmentVariable("Path", "User")',
    '$pathEntries = if ($userPath) { $userPath -split ";" } else { @() }',
    'if ($pathEntries -notcontains $installDir) {',
    '  $newUserPath = if ($userPath) { "$userPath;$installDir" } else { $installDir }',
    '  [Environment]::SetEnvironmentVariable("Path", $newUserPath, "User")',
    "}",
    'if (($env:Path -split ";") -notcontains $installDir) { $env:Path = "$installDir;$env:Path" }',
    'Write-Host "Enact CLI installed to $installDir\\enact.exe" -ForegroundColor Green',
    'Write-Host "Open a new PowerShell window, then run: enact version"',
    "",
  ].join("\r\n");
}

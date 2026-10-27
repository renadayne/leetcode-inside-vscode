'use strict';

// Dependency-free Node.js VSIX and source archive builder with deliberate allowlist.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.resolve(__dirname, '..');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function escapeXml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;'
  }[ch]));
}

function toPosixPath(p) {
  const normalized = String(p).replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..') || normalized.includes('//')) {
    throw new Error(`Unsafe archive entry path: ${p}`);
  }
  return normalized;
}

function createZipBuffer(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const name = toPosixPath(entry.name);
    const nameBuf = Buffer.from(name, 'utf8');
    const rawBuf = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8');
    const compressedBuf = zlib.deflateRawSync(rawBuf, { level: 9 });
    const checksum = crc32(rawBuf);
    const dosTime = 0x0000;
    const dosDate = 0x555B; // 2026-10-27

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034B50, 0); // Local file header signature
    localHeader.writeUInt16LE(20, 4);         // Version needed to extract (2.0)
    localHeader.writeUInt16LE(0x0800, 6);     // UTF-8 filename flag
    localHeader.writeUInt16LE(8, 8);          // Compression method: Deflate (8)
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressedBuf.length, 18);
    localHeader.writeUInt32LE(rawBuf.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);         // Extra field length

    localParts.push(localHeader, nameBuf, compressedBuf);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014B50, 0); // Central directory file header signature
    centralHeader.writeUInt16LE(20, 4);         // Version made by
    centralHeader.writeUInt16LE(20, 6);         // Version needed to extract
    centralHeader.writeUInt16LE(0x0800, 8);     // UTF-8 filename flag
    centralHeader.writeUInt16LE(8, 10);         // Compression method: Deflate (8)
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressedBuf.length, 20);
    centralHeader.writeUInt32LE(rawBuf.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);         // Extra field length
    centralHeader.writeUInt16LE(0, 32);         // File comment length
    centralHeader.writeUInt16LE(0, 34);         // Disk number start
    centralHeader.writeUInt16LE(0, 36);         // Internal file attributes
    centralHeader.writeUInt32LE(0, 38);         // External file attributes
    centralHeader.writeUInt32LE(offset, 42);    // Relative offset of local header

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + compressedBuf.length;
  }

  const centralBuffer = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054B50, 0);            // End of central directory signature
  eocd.writeUInt16LE(0, 4);                     // Number of this disk
  eocd.writeUInt16LE(0, 6);                     // Disk where central directory starts
  eocd.writeUInt16LE(entries.length, 8);        // Number of central directory records on this disk
  eocd.writeUInt16LE(entries.length, 10);       // Total number of central directory records
  eocd.writeUInt32LE(centralBuffer.length, 12); // Size of central directory
  eocd.writeUInt32LE(offset, 16);               // Offset of start of central directory
  eocd.writeUInt16LE(0, 20);                    // Comment length

  return Buffer.concat([...localParts, centralBuffer, eocd]);
}

function readZipEntries(zipBuffer) {
  const eocdOffset = zipBuffer.length - 22;
  if (eocdOffset < 0 || zipBuffer.readUInt32LE(eocdOffset) !== 0x06054B50) {
    throw new Error('Invalid ZIP End of Central Directory record.');
  }
  const count = zipBuffer.readUInt16LE(eocdOffset + 10);
  const centralOffset = zipBuffer.readUInt32LE(eocdOffset + 16);
  const results = [];
  let ptr = centralOffset;

  for (let i = 0; i < count; i++) {
    if (zipBuffer.readUInt32LE(ptr) !== 0x02014B50) {
      throw new Error('Invalid Central Directory entry signature.');
    }
    const method = zipBuffer.readUInt16LE(ptr + 10);
    const expectedCrc = zipBuffer.readUInt32LE(ptr + 16);
    const compressedSize = zipBuffer.readUInt32LE(ptr + 20);
    const uncompressedSize = zipBuffer.readUInt32LE(ptr + 24);
    const nameLen = zipBuffer.readUInt16LE(ptr + 28);
    const extraLen = zipBuffer.readUInt16LE(ptr + 30);
    const commentLen = zipBuffer.readUInt16LE(ptr + 32);
    const localOffset = zipBuffer.readUInt32LE(ptr + 42);
    const name = zipBuffer.subarray(ptr + 46, ptr + 46 + nameLen).toString('utf8');

    if (zipBuffer.readUInt32LE(localOffset) !== 0x04034B50) {
      throw new Error(`Invalid Local Header for ${name}`);
    }
    const localNameLen = zipBuffer.readUInt16LE(localOffset + 26);
    const localExtraLen = zipBuffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const compData = zipBuffer.subarray(dataStart, dataStart + compressedSize);
    const rawData = method === 8 ? zlib.inflateRawSync(compData) : compData;

    if (rawData.length !== uncompressedSize || crc32(rawData) !== expectedCrc) {
      throw new Error(`CRC or size mismatch in archive entry: ${name}`);
    }
    results.push({ name, size: uncompressedSize, data: rawData });
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return results;
}

const RUNTIME_ALLOWLIST = [
  'package.json',
  'README.md',
  'LICENSE',
  'CHANGELOG.md',
  'SECURITY.md',
  'VERIFICATION.md',
  'media/leetcode.svg',
  'media/dashboard.css',
  'media/dashboard.js',
  'src/api.js',
  'src/dashboard.js',
  'src/discovery.js',
  'src/explorer.js',
  'src/extension.js',
  'src/jobs.js',
  'src/render.js',
  'src/store.js'
];

const SOURCE_ALLOWLIST = [
  ...RUNTIME_ALLOWLIST,
  '.gitignore',
  'IMPLEMENTATION_PLAN.md',
  '.vscode/launch.json',
  'scripts/check.js',
  'scripts/package.js',
  'scripts/package.py',
  'scripts/smoke-live.js',
  'test/core.test.js',
  'test/discovery-api.test.js',
  'test/extension.test.js'
];

function buildVsixManifest(manifest) {
  return `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata><Identity Language="en-US" Id="${escapeXml(manifest.name)}" Version="${escapeXml(manifest.version)}" Publisher="${escapeXml(manifest.publisher)}"/>
    <DisplayName>${escapeXml(manifest.displayName)}</DisplayName>
    <Description xml:space="preserve">${escapeXml(manifest.description)}</Description>
    <Tags>C++,LeetCode</Tags><Categories>Education</Categories><GalleryFlags>Public</GalleryFlags>
    <Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="${escapeXml(manifest.engines.vscode)}"/>
    <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value=""/>
    <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value=""/>
    <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="ui"/>
    <Property Id="Microsoft.VisualStudio.Code.LocalizedLanguages" Value=""/>
    <Property Id="Microsoft.VisualStudio.Code.ExecutesCode" Value="true"/></Properties>
    <License>extension/LICENSE</License>
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/>
  <Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/>
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true"/>
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE" Addressable="true"/>
    <Asset Type="Microsoft.VisualStudio.Services.Content.Changelog" Path="extension/CHANGELOG.md" Addressable="true"/></Assets>
</PackageManifest>`;
}

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="json" ContentType="application/json"/><Default Extension="js" ContentType="application/javascript"/>
<Default Extension="css" ContentType="text/css"/><Default Extension="md" ContentType="text/markdown"/>
<Default Extension="svg" ContentType="image/svg+xml"/><Default Extension="vsixmanifest" ContentType="text/xml"/>
<Override PartName="/extension/LICENSE" ContentType="text/plain"/></Types>`;

function buildPackages(rootDir = ROOT, customOutDir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  let outDir = customOutDir ? path.resolve(customOutDir) : (process.env.LC_PACKAGE_OUT ? path.resolve(process.env.LC_PACKAGE_OUT) : path.join(rootDir, 'dist'));
  const stem = `${manifest.name}-${manifest.version}`;

  const vsixEntries = [
    { name: 'extension.vsixmanifest', data: buildVsixManifest(manifest) },
    { name: '[Content_Types].xml', data: CONTENT_TYPES_XML }
  ];

  for (const rel of RUNTIME_ALLOWLIST) {
    const abs = path.join(rootDir, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      throw new Error(`Missing required runtime file for VSIX: ${rel}`);
    }
    vsixEntries.push({
      name: `extension/${toPosixPath(rel)}`,
      data: fs.readFileSync(abs)
    });
  }

  const sourceEntries = [];
  for (const rel of SOURCE_ALLOWLIST) {
    const abs = path.join(rootDir, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      throw new Error(`Missing required source file for archive: ${rel}`);
    }
    sourceEntries.push({
      name: `${stem}/${toPosixPath(rel)}`,
      data: fs.readFileSync(abs)
    });
  }

  const vsixBuffer = createZipBuffer(vsixEntries);
  const sourceZipBuffer = createZipBuffer(sourceEntries);

  let vsixPath = path.join(outDir, `${stem}.vsix`);
  let sourceZipPath = path.join(outDir, `${stem}-source.zip`);
  try {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(vsixPath, vsixBuffer);
    fs.writeFileSync(sourceZipPath, sourceZipBuffer);
  } catch (err) {
    if (!customOutDir && !process.env.LC_PACKAGE_OUT && err && err.code === 'EPERM') {
      outDir = path.join(os.tmpdir(), `${stem}-dist`);
      fs.mkdirSync(outDir, { recursive: true });
      vsixPath = path.join(outDir, `${stem}.vsix`);
      sourceZipPath = path.join(outDir, `${stem}-source.zip`);
      fs.writeFileSync(vsixPath, vsixBuffer);
      fs.writeFileSync(sourceZipPath, sourceZipBuffer);
    } else {
      throw err;
    }
  }

  // Verify both archives by reading back and inflating all entries.
  const verifiedVsix = readZipEntries(fs.readFileSync(vsixPath));
  const verifiedSource = readZipEntries(fs.readFileSync(sourceZipPath));

  for (const entry of [...verifiedVsix, ...verifiedSource]) {
    if (entry.name.includes('\\')) {
      throw new Error(`Backslash found in archive entry path: ${entry.name}`);
    }
    if (/(?:^|\/)(?:\.git|dist|node_modules|\.env|.*secret.*|.*cookie.*)(?:\/|$)/i.test(entry.name)) {
      throw new Error(`Forbidden path included in archive: ${entry.name}`);
    }
  }

  return {
    vsixPath,
    sourceZipPath,
    vsixEntries: verifiedVsix.map(e => e.name),
    sourceEntries: verifiedSource.map(e => e.name)
  };
}

if (require.main === module) {
  const result = buildPackages(ROOT, process.argv[2]);
  console.log(result.vsixPath);
  console.log(result.sourceZipPath);
}

module.exports = {
  RUNTIME_ALLOWLIST,
  SOURCE_ALLOWLIST,
  buildPackages,
  readZipEntries,
  createZipBuffer,
  toPosixPath
};

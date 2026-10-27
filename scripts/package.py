"""Build an auditable, dependency-free VSIX and source ZIP. Does not publish."""
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape

root = Path(__file__).resolve().parent.parent
manifest = json.loads((root / 'package.json').read_text(encoding='utf-8'))
out = root / 'dist'
out.mkdir(exist_ok=True)
stem = f"{manifest['name']}-{manifest['version']}"
runtime = [
    'package.json', 'README.md', 'LICENSE', 'CHANGELOG.md', 'SECURITY.md', 'VERIFICATION.md',
    'media/leetcode.svg', 'media/dashboard.css', 'media/dashboard.js',
    'src/api.js', 'src/dashboard.js', 'src/discovery.js', 'src/explorer.js', 'src/extension.js',
    'src/jobs.js', 'src/render.js', 'src/store.js'
]
source_files = runtime + [
    '.gitignore', 'IMPLEMENTATION_PLAN.md', '.vscode/launch.json',
    'scripts/check.js', 'scripts/package.js', 'scripts/package.py', 'scripts/smoke-live.js',
    'test/core.test.js', 'test/discovery-api.test.js', 'test/extension.test.js'
]
vsix_manifest = f'''<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata><Identity Language="en-US" Id="{escape(manifest['name'])}" Version="{manifest['version']}" Publisher="{manifest['publisher']}"/>
    <DisplayName>{escape(manifest['displayName'])}</DisplayName>
    <Description xml:space="preserve">{escape(manifest['description'])}</Description>
    <Tags>C++,LeetCode</Tags><Categories>Education</Categories><GalleryFlags>Public</GalleryFlags>
    <Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="{escape(manifest['engines']['vscode'])}"/>
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
</PackageManifest>'''
content_types = '''<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="json" ContentType="application/json"/><Default Extension="js" ContentType="application/javascript"/>
<Default Extension="css" ContentType="text/css"/><Default Extension="md" ContentType="text/markdown"/>
<Default Extension="svg" ContentType="image/svg+xml"/><Default Extension="vsixmanifest" ContentType="text/xml"/>
<Override PartName="/extension/LICENSE" ContentType="text/plain"/></Types>'''
with ZipFile(out / f'{stem}.vsix', 'w', ZIP_DEFLATED) as z:
    z.writestr('extension.vsixmanifest', vsix_manifest)
    z.writestr('[Content_Types].xml', content_types)
    for name in runtime:
        z.write(root / name, 'extension/' + name.replace('\\', '/'))
with ZipFile(out / f'{stem}-source.zip', 'w', ZIP_DEFLATED) as z:
    for name in source_files:
        z.write(root / name, stem + '/' + name.replace('\\', '/'))
print(out / f'{stem}.vsix')
print(out / f'{stem}-source.zip')

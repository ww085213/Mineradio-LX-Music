"""Validate the *built* IPA (or .app), not just the source checkout."""
import argparse
import hashlib
import json
from pathlib import Path
import plistlib
import re
import zipfile


def verify(target, repo):
    archive = zipfile.ZipFile(target) if target.is_file() else None
    try:
        if archive:
            roots = [n[:-len('Info.plist')] for n in archive.namelist()
                     if re.fullmatch(r'Payload/[^/]+\.app/Info\.plist', n)]
            assert len(roots) == 1, 'Expected exactly one app in Payload'
            read = lambda name: archive.read(roots[0] + name)
            assert archive.testzip() is None, 'Corrupt ZIP entry'
        else:
            read = lambda name: (target / name).read_bytes()

        info = plistlib.loads(read('Info.plist'))
        assert info['CFBundleShortVersionString'] == '1.6.1'
        assert info['CFBundleVersion'] == '4', 'Wrong iOS build number'
        assert info['CFBundleIdentifier'] == 'com.ww085213.mineradio.mobile'
        executable = read(info['CFBundleExecutable'])
        assert b'MineradioNativePlugin' in executable, 'Missing native audio/Keychain plugin'
        assert info['CFBundleIcons']['CFBundlePrimaryIcon']['CFBundleIconName'] == 'AppIcon', 'Missing MR app icon'
        assert 'audio' in info['UIBackgroundModes']
        config = json.loads(read('capacitor.config.json'))
        assert config['plugins']['Nodejs'] == {'nodeDir': 'nodejs', 'startMode': 'manual'}
        assert config['ios']['contentInset'] == 'never', 'Unexpected iOS safe-area inset'

        html = read('public/index.html').decode('utf-8')
        tags = list(re.finditer(r'<script\b[^>]*\bsrc=[\"\'](?:\./)?mobile-bridge\.js[\"\'][^>]*>\s*</script>', html, re.I))
        assert len(tags) == 1, 'Missing or duplicated mobile-bridge.js entry script'
        assert tags[0].start() < html.lower().index('</head>'), 'Bridge must load in head'
        # Build inserts exactly these two scripts; no desktop overwrite allowed.
        source_html = (repo / 'public/index.html').read_text(encoding='utf-8')
        scripts = '<script src="mobile-bridge.js"></script>\n<script src="mobile-ipad.js"></script>\n'
        assert html.replace('\r\n', '\n') == source_html.replace('</head>', scripts + '</head>', 1), 'UI differs from checked source'

        mapping = {
            'public/mobile-bridge.js': 'ios-support/mobile-bridge.js',
            'public/mobile-ipad.js': 'ios-support/mobile-ipad.js',
            'public/nodejs/mobile-node-main.js': 'ios-support/mobile-node-main.js',
            'public/nodejs/public/index.html': 'public/index.html',
            'public/nodejs/server.js': 'server.js',
            'public/nodejs/lx-search.js': 'lx-search.js',
            'public/nodejs/lx-source-host.js': 'lx-source-host.js',
            'public/nodejs/platform-playlist-import.js': 'platform-playlist-import.js',
            'public/nodejs/multimodal-recommender.js': 'multimodal-recommender.js',
            'public/nodejs/agent-api.js': 'agent-api.js',
            'public/nodejs/mobile-media-cache.js': 'mobile-media-cache.js',
        }
        for packed, source in mapping.items():
            actual = read(packed).replace(b'\r\n', b'\n')
            expected = (repo / source).read_bytes().replace(b'\r\n', b'\n')
            assert actual == expected, 'Stale/missing packaged source: ' + packed
        bridge = read('public/mobile-bridge.js')
        assert b'1.6.1-ipad-4' in bridge and b'CapacitorHttp' in bridge
        assert read('public/mobile-app-icon.png') == (repo / 'build/icon.png').read_bytes()
        assert b'mineradio-local-engine' in read('public/nodejs/server.js')
        assert json.loads(read('public/nodejs/package.json'))['version'] == '1.6.1'
        assert read('public/nodejs/node_modules/qrcode/package.json')
        print('PASS: build 4; both entry scripts; native audio/Keychain; MR icon; edge-to-edge; exact UI/source match')
        if archive:
            print('SHA256: ' + hashlib.sha256(target.read_bytes()).hexdigest())
    finally:
        if archive:
            archive.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('target', type=Path)
    parser.add_argument('--repo', type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    verify(args.target, args.repo)

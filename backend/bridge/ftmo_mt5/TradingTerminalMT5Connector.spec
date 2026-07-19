# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path

from PyInstaller.utils.hooks import collect_all


package_dir = Path(SPECPATH)
backend_dir = package_dir.parents[1]
mt5_datas, mt5_binaries, mt5_hiddenimports = collect_all("MetaTrader5")

a = Analysis(
    [str(package_dir / "connector_launcher.py")],
    pathex=[str(backend_dir)],
    binaries=mt5_binaries,
    datas=mt5_datas,
    hiddenimports=[*mt5_hiddenimports, "websockets"],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=1,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="TradingTerminalMT5Connector",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

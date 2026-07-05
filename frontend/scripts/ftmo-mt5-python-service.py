#!/usr/bin/env python
"""Thin wrapper that runs the FTMO MT5 bridge from the frontend/ directory.

Sets up sys.path so Python can find the bridge package under ../backend.
"""

import os
import sys

backend = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "backend"))
if backend not in sys.path:
    sys.path.insert(0, backend)

import asyncio

from bridge.ftmo_mt5.service import main  # noqa: E402

if __name__ == "__main__":
    asyncio.run(main())

"""Zero-configuration desktop entrypoint for TradingTerminal's MT5 Connector."""

from __future__ import annotations

import argparse
import asyncio
import signal
from typing import Sequence
from urllib.parse import urlparse

from .config import companion_config
from .connector_auth import BackendTicketValidator, DEFAULT_API_BASE_URL
from .service import FtmoMt5Service


DEFAULT_ALLOWED_ORIGINS = ("https://tradingterminal.io.vn",)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="TradingTerminal MT5 Connector")
    parser.add_argument(
        "--api-base-url",
        default=DEFAULT_API_BASE_URL,
        help="Administrator/development override for the TradingTerminal API URL.",
    )
    parser.add_argument(
        "--allow-origin",
        action="append",
        default=[],
        metavar="ORIGIN",
        help="Additional exact web Origin for local development.",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8787,
        help="Loopback port override for local development (default: 8787).",
    )
    return parser


def create_service(argv: Sequence[str] | None = None) -> FtmoMt5Service:
    args = build_parser().parse_args(argv)
    origins = _allowed_origins(args.allow_origin)
    return FtmoMt5Service(
        companion_config(port=args.port),
        ticket_validator=BackendTicketValidator(args.api_base_url),
        allowed_origins=origins,
    )


async def run(argv: Sequence[str] | None = None) -> None:
    service = create_service(argv)
    loop = asyncio.get_running_loop()
    stop = loop.create_future()
    for signame in ("SIGINT", "SIGTERM"):
        try:
            loop.add_signal_handler(getattr(signal, signame), stop.set_result, None)
        except (AttributeError, NotImplementedError):
            pass
    task = asyncio.create_task(service.start())
    try:
        await asyncio.wait(
            {task, stop}, return_when=asyncio.FIRST_COMPLETED
        )
        if task.done():
            task.result()
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        service.adapter.shutdown()


def main(argv: Sequence[str] | None = None) -> None:
    asyncio.run(run(argv))


def _allowed_origins(additional: Sequence[str]) -> tuple[str, ...]:
    result = list(DEFAULT_ALLOWED_ORIGINS)
    for raw in additional:
        origin = str(raw or "").strip().rstrip("/")
        parsed = urlparse(origin)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.netloc
            or parsed.username
            or parsed.password
            or parsed.path
            or parsed.params
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("allowed Origin must be an exact HTTP(S) origin")
        if origin not in result:
            result.append(origin)
    return tuple(result)


if __name__ == "__main__":
    main()

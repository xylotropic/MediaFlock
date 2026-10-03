#!/usr/bin/python3
"""Freeze decoder descendants, then stream one bounded regular output file."""
import os
import re
import signal
import stat
import sys

LIMIT = 50 * 1024 * 1024
if len(sys.argv) != 2 or not re.fullmatch(r"/work/result\.(mp4|png|jpe?g|webp)", sys.argv[1]):
    raise SystemExit("Invalid parser output path.")
# Linux kill(-1) excludes the sender and namespace PID 1. Only existing
# same-UID processes are eligible; a stopped decoder cannot race extraction.
try:
    os.kill(-1, signal.SIGSTOP)
except ProcessLookupError:
    pass
fd = os.open(sys.argv[1], os.O_RDONLY | os.O_NOFOLLOW)
info = os.fstat(fd)
if not stat.S_ISREG(info.st_mode) or info.st_size > LIMIT:
    raise SystemExit("Parser output exceeded 50 MiB or was not a regular file.")
remaining = LIMIT
while True:
    block = os.read(fd, min(64 * 1024, remaining + 1))
    if not block:
        break
    remaining -= len(block)
    if remaining < 0:
        raise SystemExit("Parser output exceeded 50 MiB.")
    sys.stdout.buffer.write(block)
sys.stdout.buffer.flush()
os.close(fd)

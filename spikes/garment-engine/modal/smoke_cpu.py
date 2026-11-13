"""CPU-only Modal smoke test: proves login, image build and a remote call work
without a GPU (and without a payment method on the account).

Run:  modal run spikes/garment-engine/modal/smoke_cpu.py
"""
import platform
import time

import modal

app = modal.App("curtain-phase0-smoke-cpu")


@app.function(timeout=60)
def square(x: int) -> dict:
    return {"result": x * x, "python": platform.python_version(), "machine": platform.machine()}


@app.local_entrypoint()
def main():
    t = time.time()
    out = square.remote(42)
    out["wall_incl_cold_start_s"] = round(time.time() - t, 1)
    print("square(42):", out)

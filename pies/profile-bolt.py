#!/usr/bin/env python3
"""Best-effort macOS Pi-Bolt resident-session benchmark. Run from the repo root."""

import concurrent.futures
import csv
import json
import os
from pathlib import Path
import signal
import statistics
import subprocess
import sys
import threading
import time

ROOT = Path(__file__).resolve().parent.parent
FILES = ["pies/README.md", "pies/daemon.ts", "pies/runner.ts", "pies/request-context.ts",
         "pies/cli.ts", "pies/protocol.ts"]
PROMPT = (
    "This is a read-only memory benchmark, not an implementation task. "
    "Use the read tool to inspect each of these files: " + ", ".join(FILES) + ". "
    "Then give a 250–400 word summary of Pies: architecture, request isolation, "
    "concurrency, CLI routing and limitations. Do not edit files, run checks, "
    "create tasks or delegate work. Finish after the summary."
)
COMMAND = ["pi-bolt", "--mode", "rpc", "--no-session", "--model", "openai/gpt-6-luna",
           "--thinking", "high", "--tools", "read", "--approve"]


class Agent:
    def __init__(self, index, output):
        self.index = index
        self.output = output
        self.settled = threading.Event()
        self.error = None
        self.summary = ""
        self.reads = set()
        self.model = None
        self.thinking = None
        self.stderr = (output / f"agent-{index:02}.stderr").open("wb")
        self.process = subprocess.Popen(COMMAND, cwd=ROOT, stdin=subprocess.PIPE,
                                        stdout=subprocess.PIPE, stderr=self.stderr,
                                        start_new_session=True)
        self.thread = threading.Thread(target=self.consume, daemon=True)
        self.thread.start()
        self.process.stdin.write((json.dumps({"id": "summary", "type": "prompt",
                                             "message": PROMPT}) + "\n").encode())
        self.process.stdin.flush()

    def consume(self):
        try:
            with (self.output / f"agent-{self.index:02}.jsonl").open("wb") as log:
                for line in self.process.stdout:
                    log.write(line)
                    log.flush()
                    event = json.loads(line)
                    kind = event.get("type")
                    if kind == "response" and not event["success"]:
                        raise RuntimeError(str(event))
                    if kind == "tool_execution_start" and event["toolName"] == "read":
                        self.reads.add(event["args"]["path"])
                    if kind == "tool_execution_end" and event.get("isError"):
                        raise RuntimeError(str(event))
                    if kind == "message_end" and event["message"]["role"] == "assistant":
                        message = event["message"]
                        if message["stopReason"] in ("error", "aborted"):
                            raise RuntimeError(str(message))
                        self.model = f'{message["provider"]}/{message["model"]}'
                        self.thinking = message.get("thinkingLevel")
                        if message["stopReason"] == "stop":
                            self.summary = "\n".join(part["text"] for part in message["content"]
                                                      if part["type"] == "text")
                    if kind == "agent_settled":
                        if event.get("aborted"):
                            raise RuntimeError("Agent aborted")
                        missing = [name for name in FILES if not any(
                            Path(path).resolve() == ROOT / name for path in self.reads)]
                        if missing or not 250 <= len(self.summary.split()) <= 400:
                            raise RuntimeError(f"Invalid workload: missing={missing}, "
                                               f"words={len(self.summary.split())}")
                        self.settled.set()
                if not self.settled.is_set():
                    raise RuntimeError("Process exited before settling")
        except Exception as error:
            self.error = str(error)
            self.settled.set()

    def wait(self):
        if not self.settled.wait(240):
            raise TimeoutError(f"Agent {self.index} exceeded 240s")
        if self.error:
            raise RuntimeError(f"Agent {self.index}: {self.error}")
        (self.output / f"agent-{self.index:02}-summary.txt").write_text(self.summary)
        print(f"Agent {self.index}: {len(self.summary.split())} words, "
              f"{len(self.reads)} files, {self.model}, thinking={self.thinking}", flush=True)

    def close(self):
        if self.process.poll() is None:
            self.process.stdin.close()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(self.process.pid, signal.SIGTERM)
                try:
                    self.process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(self.process.pid, signal.SIGKILL)
                    self.process.wait()
        self.thread.join(timeout=5)
        self.stderr.close()


def sample(agents, output, checkpoint, number):
    for agent in agents:
        if agent.process.poll() is not None or agent.error:
            raise RuntimeError(f"Agent {agent.index} no longer healthy")
    table = subprocess.check_output(["ps", "-axo", "pid=,ppid=,rss="], text=True)
    processes = {int(pid): (int(parent), int(rss))
                 for pid, parent, rss in (line.split() for line in table.splitlines())}
    roots = {agent.process.pid for agent in agents}
    pids = set(roots)
    while True:
        children = {pid for pid, (parent, _) in processes.items() if parent in pids}
        if children <= pids:
            break
        pids |= children
    path = output / f"footprint-{checkpoint:02}-{number}.json"
    command = ["/usr/bin/footprint", "--noCategories", "-f", "bytes", "-j", str(path)]
    for pid in sorted(pids):
        command.extend(["-p", str(pid)])
    result = subprocess.run(command, text=True, capture_output=True, check=True)
    path.with_suffix(".txt").write_text(result.stdout + result.stderr)
    data = json.loads(path.read_text())
    if data["errors"] or data["warnings"]:
        raise RuntimeError(f"Footprint diagnostics: {data['errors']}, {data['warnings']}")
    if {process["pid"] for process in data["processes"]} != pids:
        raise RuntimeError("Footprint did not measure the complete process tree")
    footprint = sum(process["footprint"] for process in data["processes"]) / 2**20
    child_footprint = sum(process["footprint"] for process in data["processes"]
                          if process["pid"] not in roots) / 2**20
    rss = sum(processes[pid][1] for pid in pids) / 1024
    return footprint, child_footprint, rss, len(pids)


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python3 pies/profile-bolt.py NEW_OUTPUT_DIRECTORY")
    output = Path(sys.argv[1]).resolve()
    output.mkdir(parents=True, exist_ok=False)
    metadata = {"command": COMMAND, "prompt": PROMPT, "cwd": str(ROOT),
                "date_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "version": subprocess.check_output(["pi-bolt", "--version"], text=True).strip(),
                "os": subprocess.check_output(["sw_vers"], text=True).strip(),
                "ram_bytes": int(subprocess.check_output(["sysctl", "-n", "hw.memsize"])),
                "git_head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT,
                                                    text=True).strip()}
    (output / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
    agents = []
    fields = ["model", "workload", "concurrent_agents", "bolt_total_physical_footprint_mib",
              "bolt_descendant_physical_footprint_mib", "bolt_total_resident_rss_mib",
              "physical_footprint_min_mib", "physical_footprint_max_mib", "process_count",
              "summary_mean_words", "samples"]
    try:
        with (output / "memory-scaling-bolt-luna6.csv").open("w") as file:
            writer = csv.DictWriter(file, fieldnames=fields, lineterminator="\n")
            writer.writeheader()
            for checkpoint in range(2, 21, 2):
                batch = []
                for index in range(len(agents) + 1, checkpoint + 1):
                    agent = Agent(index, output)
                    agents.append(agent)
                    batch.append(agent)
                for agent in batch:
                    agent.wait()
                time.sleep(5)
                samples = []
                for number in range(1, 4):
                    samples.append(sample(agents, output, checkpoint, number))
                    if number < 3:
                        time.sleep(2)
                models = {agent.model for agent in agents}
                if len(models) != 1:
                    raise RuntimeError(f"Mixed models: {models}")
                row = dict(zip(fields, [models.pop(), "pies_codebase_summary_rpc_idle", checkpoint,
                    round(statistics.median(s[0] for s in samples), 1),
                    round(statistics.median(s[1] for s in samples), 1),
                    round(statistics.median(s[2] for s in samples), 1),
                    round(min(s[0] for s in samples), 1), round(max(s[0] for s in samples), 1),
                    max(s[3] for s in samples),
                    round(statistics.mean(len(a.summary.split()) for a in agents), 1), 3]))
                writer.writerow(row)
                file.flush()
                print(json.dumps(row), flush=True)
    finally:
        with concurrent.futures.ThreadPoolExecutor(max_workers=20) as pool:
            list(pool.map(lambda agent: agent.close(), agents))


if __name__ == "__main__":
    main()

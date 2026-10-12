import json, sys, urllib.request
body = json.loads(open(sys.argv[1]).read().split("\n", 1)[1])
mode = sys.argv[2]
if mode in ("no-namespace", "no-both"): body["tools"] = [t for t in body["tools"] if t.get("type") != "namespace"]
if mode in ("no-websearch", "no-both"): body["tools"] = [t for t in body["tools"] if t.get("type") != "web_search"]
req = urllib.request.Request("http://127.0.0.1:11434/v1/responses", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
names = []
for raw in urllib.request.urlopen(req, timeout=280):
    line = raw.decode().strip()
    if line.startswith("data:") and "output_item.done" in line:
        item = json.loads(line[5:])["item"]
        if item.get("type") == "function_call": names.append((item.get("name"), item.get("arguments")))
print(mode, names)

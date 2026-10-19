# JARVIS signal-feed Lambda patch

The dashboard's existing `POST /status` endpoint can stay as-is. Add the following two branches to the **existing** `TradingEAStatus` Lambda. Do not replace the working heartbeat/positions branches.

## 1. Save an incoming signal

In the current `lambda_handler`, after parsing `body` and reading `source = body.get("source")`, add this branch before the final unknown-source response:

```python
    if source == "jarvis-signal":
        signal = body.get("signal")
        if not isinstance(signal, dict):
            return response(400, {"status": "error", "message": "signal must be an object"})
        required = ("signal_id", "symbol", "direction", "entry", "sl", "tp", "timestamp")
        if any(key not in signal for key in required):
            return response(400, {"status": "error", "message": "signal fields missing"})
        if signal.get("direction") not in ("BUY", "SELL"):
            return response(400, {"status": "error", "message": "invalid signal direction"})
        try:
            item = {
                "id": "jarvis-signal#" + str(signal["symbol"]),
                "source": "jarvis-signal",
                "symbol": str(signal["symbol"])[:40],
                "direction": signal["direction"],
                "signal_json": json.dumps(signal, separators=(",", ":")),
                "timestamp": str(signal["timestamp"]),
                "last_seen_epoch": int(time.time()),
            }
            table.put_item(Item=item)
            return response(200, {"status": "ok", "message": "signal stored"})
        except Exception as exc:
            print("Signal write failed:", str(exc))
            return response(500, {"status": "error", "message": "signal storage failed"})
```

This uses the Lambda's existing `table`, `response`, `json`, and `time` objects. If your deployed handler uses different variable names, adapt to its existing names instead of overwriting it.

## 2. Include recent signals in the dashboard status response

In the existing `source == "jarvis-dashboard"` response path, before its final `return response(200, ...)`, load recent signal records and add `signals` to the response object:

```python
        signals = []
        try:
            result = table.scan(
                FilterExpression=Attr("source").eq("jarvis-signal"),
                ProjectionExpression="signal_json, last_seen_epoch"
            )
            records = result.get("Items", [])
            while result.get("LastEvaluatedKey"):
                result = table.scan(
                    FilterExpression=Attr("source").eq("jarvis-signal"),
                    ProjectionExpression="signal_json, last_seen_epoch",
                    ExclusiveStartKey=result["LastEvaluatedKey"]
                )
                records.extend(result.get("Items", []))
            now_epoch = int(time.time())
            for record in records:
                age = now_epoch - int(record.get("last_seen_epoch", 0))
                if age <= 86400 and record.get("signal_json"):
                    try:
                        signals.append(json.loads(record["signal_json"]))
                    except (TypeError, ValueError):
                        pass
            signals.sort(key=lambda item: item.get("timestamp", ""), reverse=True)
            signals = signals[:50]
        except Exception as exc:
            print("Signal read failed:", str(exc))

        # Add this property to the existing dashboard response dictionary:
        "signals": signals,
```

Add this import near the top if not already present:

```python
from boto3.dynamodb.conditions import Attr
```

**IAM permission:** the Lambda execution role needs `dynamodb:Scan` on the existing `EATRADEStatus` table. Keep the existing PutItem/GetItem permissions. This scan reads only records marked `source=jarvis-signal`; do not return `positions_json` or account-private records in the dashboard response.

## MT5 setup

1. Compile `mt5/JARVIS_SignalOnly_SMC.mq5` in MetaEditor.
2. In MT5 Options → Expert Advisors, allow WebRequest for `https://7qen6wleeb.execute-api.eu-west-2.amazonaws.com`.
3. Attach the signal-only EA to a chart. Set the bias and entry timeframes for your intended strategy.
4. Confirm the Experts tab reports `JARVIS signal publish HTTP 200`.
5. Refresh the dashboard's Signals tab.

This EA contains no trade send/close/modify calls. It only evaluates closed-candle structure and publishes confirmed setups. It is a generic version of the saved JARVIS SMC logic, not a byte-for-byte clone of every existing EA. Validate symbol naming, strategy settings, and signal quality on a demo chart before relying on it.

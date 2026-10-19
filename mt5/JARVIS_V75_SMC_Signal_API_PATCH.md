# JARVIS V75 SMC indicator → dashboard signal API

This patch publishes only the BUY/SELL signals produced by the user's `JARVIS_V75_SMC_Signal.mq5`. It does not place trades or replace the indicator's strategy.

## API endpoint

Use the existing API Gateway endpoint:

```
https://7qen6wleeb.execute-api.eu-west-2.amazonaws.com/status
```

The dashboard already calls `POST /status` and its Signals tab already renders the `signals` array returned by the `jarvis-dashboard` response. The deployed Lambda must be updated as described in `aws/LAMBDA_SIGNAL_PATCH.md` before the end-to-end feed works.

## 1. Add these inputs near the indicator inputs

```mql5
input bool   InpPublishToDashboard = true; // Publish confirmed signals to JARVIS dashboard
input string InpDashboardApiUrl = "https://7qen6wleeb.execute-api.eu-west-2.amazonaws.com/status";
input string InpSignalStrategy = "JARVIS V75 M30 SMC + M5 Signal";
```

## 2. Add these functions before OnCalculate

```mql5
string JsonEscape(string value)
  {
   StringReplace(value, "\\\\", "\\\\\\\\");
   StringReplace(value, "\"", "\\\\\"");
   StringReplace(value, "\r", "");
   StringReplace(value, "\n", "\\\\n");
   return value;
  }

bool PublishDashboardSignal(const bool isBuy,
                            const datetime signalTime,
                            const double entry,
                            const double sl,
                            const double tp,
                            const double size)
  {
   if(!InpPublishToDashboard || StringLen(InpDashboardApiUrl) < 12)
      return false;

   string direction = isBuy ? "BUY" : "SELL";
   string signalId = _Symbol + "_" + direction + "_" + IntegerToString((long)signalTime);
   string stamp = TimeToString(signalTime, TIME_DATE|TIME_SECONDS);
   StringReplace(stamp, ".", "-");

   string payload = StringFormat(
      "{\\"source\\":\\"jarvis-signal\\",\\"signal\\":{\\"signal_id\\":\\"%s\\",\\"symbol\\":\\"%s\\",\\"direction\\":\\"%s\\",\\"timeframe\\":\\"%s\\",\\"strategy\\":\\"%s\\",\\"entry\\":%s,\\"sl\\":%s,\\"tp\\":%s,\\"suggested_size\\":%s,\\"status\\":\\"CONFIRMED\\",\\"timestamp\\":\\"%s\\"}}",
      JsonEscape(signalId), JsonEscape(_Symbol), direction,
      EnumToString(_Period), JsonEscape(InpSignalStrategy),
      DoubleToString(entry, _Digits), DoubleToString(sl, _Digits),
      DoubleToString(tp, _Digits), DoubleToString(size, 4),
      JsonEscape(stamp));

   char request[];
   char result[];
   string responseHeaders;
   StringToCharArray(payload, request, 0, WHOLE_ARRAY, CP_UTF8);
   if(ArraySize(request) > 0)
      ArrayResize(request, ArraySize(request)-1); // remove terminal NUL

   ResetLastError();
   int http = WebRequest("POST", InpDashboardApiUrl,
                         "Content-Type: application/json\r\n",
                         5000, request, result, responseHeaders);
   if(http == 200)
     {
      Print("JARVIS dashboard signal published: ", direction, " ", _Symbol,
            " HTTP ", http);
      return true;
     }

   Print("JARVIS dashboard signal publish failed. HTTP=", http,
         " error=", GetLastError(),
         ". Check MT5 Options > Expert Advisors > allowed WebRequest URL.");
   return false;
  }
```

## 3. Publish when the existing indicator confirms a BUY

In the existing `if(buyOnce)` block, after the `size` variable is calculated and after the optional `DrawSignalObjects(...)` call, add:

```mql5
         if(i >= rates_total - 2)
            PublishDashboardSignal(true, time[i], entry, sl, tp, size);
```

## 4. Publish when the existing indicator confirms a SELL

In the existing `if(sellOnce)` block, after the `size` variable is calculated and after the optional `DrawSignalObjects(...)` call, add:

```mql5
         if(i >= rates_total - 2)
            PublishDashboardSignal(false, time[i], entry, sl, tp, size);
```

These calls are intentionally restricted to the most recent bars, matching the indicator's existing alert behavior and avoiding publishing the entire historical chart as fresh signals.

## 5. MT5 allowlist

In MT5: Tools → Options → Expert Advisors → enable **Allow WebRequest for listed URL**, then add:

```
https://7qen6wleeb.execute-api.eu-west-2.amazonaws.com
```

Compile the edited indicator in MetaEditor and attach it to the V75 chart. The Experts tab should print `JARVIS dashboard signal published ... HTTP 200` when the Lambda accepts a signal.

## Required backend deployment

The Lambda currently needs two additions before this works end to end:
- Accept `source="jarvis-signal"` and save each validated signal to the existing `EATRADEStatus` DynamoDB table.
- Include recent `signals` in the existing `source="jarvis-dashboard"` response.

Follow `aws/LAMBDA_SIGNAL_PATCH.md` and add the Lambda role permission `dynamodb:Scan` on `EATRADEStatus`. Keep the existing heartbeat and positions branches intact. Do not return `positions_json` in the public dashboard response.

The dashboard URL is https://mtk45devops.github.io/Jarvis-Dashboard/. Its Signals tab is already wired to display the real `data.signals` returned by the API; it deliberately does not show invented/demo signals.

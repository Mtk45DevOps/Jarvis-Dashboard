//+------------------------------------------------------------------+
//| JARVIS Signal-Only SMC Publisher                                 |
//| Reads closed-candle market structure and publishes signals only. |
//| NO trade/order/position modification functions are included.      |
//+------------------------------------------------------------------+
#property strict
#property version "1.00"
#property description "JARVIS signal-only SMC publisher. Never places trades."

input ENUM_TIMEFRAMES InpBiasTF = PERIOD_M30;
input ENUM_TIMEFRAMES InpEntryTF = PERIOD_M5;
input string InpApiUrl = "https://7qen6wleeb.execute-api.eu-west-2.amazonaws.com/status";
input int InpTimeoutMs = 8000;
input int InpPublishCooldownSeconds = 60;
input int InpBiasLookback = 12;
input int InpBiasSearchBars = 10;
input int InpStructureLookback = 8;
input int InpBOSSearchBars = 10;
input int InpOBSearchBars = 12;
input int InpSetupExpiryBars = 10;
input int InpSweepLookback = 6;
input int InpStopBufferPoints = 20;
input double InpRewardRiskRatio = 1.5;
input bool InpRequireLiquiditySweep = true;
input bool InpRequireFVG = false;
input bool InpRequireOBRetest = true;
input bool InpRequireRejection = true;
input double InpMinBodyToRange = 0.20;
input bool InpPublishNoSignalStatus = false;

datetime g_lastBar = 0;
datetime g_lastPublishedSignalBar = 0;
datetime g_lastPublishTime = 0;

struct SignalSetup
{
   int direction;
   datetime bosTime;
   datetime obTime;
   double obHigh;
   double obLow;
};

double HighestHigh(ENUM_TIMEFRAMES tf, int startShift, int count)
{
   double result = -DBL_MAX;
   for(int i=startShift; i<startShift+count; i++)
   {
      double value=iHigh(_Symbol,tf,i);
      if(value<=0) return 0;
      if(value>result) result=value;
   }
   return result;
}

double LowestLow(ENUM_TIMEFRAMES tf, int startShift, int count)
{
   double result = DBL_MAX;
   for(int i=startShift; i<startShift+count; i++)
   {
      double value=iLow(_Symbol,tf,i);
      if(value<=0) return 0;
      if(value<result) result=value;
   }
   return result;
}

int GetBias()
{
   for(int shift=1; shift<=InpBiasSearchBars; shift++)
   {
      double closePrice=iClose(_Symbol,InpBiasTF,shift);
      double priorHigh=HighestHigh(InpBiasTF,shift+1,InpBiasLookback);
      double priorLow=LowestLow(InpBiasTF,shift+1,InpBiasLookback);
      if(closePrice<=0 || priorHigh<=0 || priorLow<=0) continue;
      if(closePrice>priorHigh) return 1;
      if(closePrice<priorLow) return -1;
   }
   return 0;
}

bool HasSweep(int direction,int bosShift)
{
   for(int s=bosShift+1; s<=bosShift+InpSweepLookback; s++)
   {
      double hi=iHigh(_Symbol,InpEntryTF,s);
      double lo=iLow(_Symbol,InpEntryTF,s);
      double cl=iClose(_Symbol,InpEntryTF,s);
      double olderHi=HighestHigh(InpEntryTF,s+1,4);
      double olderLo=LowestLow(InpEntryTF,s+1,4);
      if(hi<=0 || lo<=0 || cl<=0 || olderHi<=0 || olderLo<=0) continue;
      if(direction==1 && lo<olderLo && cl>olderLo) return true;
      if(direction==-1 && hi>olderHi && cl<olderHi) return true;
   }
   return false;
}

bool HasFVG(int direction,int bosShift)
{
   if(bosShift<2) return false;
   double newerLow=iLow(_Symbol,InpEntryTF,bosShift-1);
   double newerHigh=iHigh(_Symbol,InpEntryTF,bosShift-1);
   double olderLow=iLow(_Symbol,InpEntryTF,bosShift+1);
   double olderHigh=iHigh(_Symbol,InpEntryTF,bosShift+1);
   if(newerLow<=0 || newerHigh<=0 || olderLow<=0 || olderHigh<=0) return false;
   if(direction==1 && newerLow>olderHigh) return true;
   if(direction==-1 && newerHigh<olderLow) return true;
   return false;
}

bool FindOB(int direction,int bosShift,double &obHigh,double &obLow,datetime &obTime)
{
   for(int s=bosShift+1; s<=bosShift+InpOBSearchBars; s++)
   {
      double op=iOpen(_Symbol,InpEntryTF,s);
      double cl=iClose(_Symbol,InpEntryTF,s);
      double hi=iHigh(_Symbol,InpEntryTF,s);
      double lo=iLow(_Symbol,InpEntryTF,s);
      if(op<=0 || cl<=0 || hi<=0 || lo<=0) continue;
      if(direction==1 && cl<op)
      {
         obHigh=hi; obLow=lo; obTime=iTime(_Symbol,InpEntryTF,s); return true;
      }
      if(direction==-1 && cl>op)
      {
         obHigh=hi; obLow=lo; obTime=iTime(_Symbol,InpEntryTF,s); return true;
      }
   }
   return false;
}

bool HasRejection(int direction,double obHigh,double obLow)
{
   double op=iOpen(_Symbol,InpEntryTF,1);
   double cl=iClose(_Symbol,InpEntryTF,1);
   double hi=iHigh(_Symbol,InpEntryTF,1);
   double lo=iLow(_Symbol,InpEntryTF,1);
   if(op<=0 || cl<=0 || hi<=0 || lo<=0) return false;
   if(InpRequireOBRetest && !(lo<=obHigh && hi>=obLow)) return false;
   double range=hi-lo;
   if(range<=0) return false;
   if(InpRequireRejection && MathAbs(cl-op)/range<InpMinBodyToRange) return false;
   double midpoint=(obHigh+obLow)/2.0;
   if(direction==1) return (cl>op && cl>=midpoint);
   if(direction==-1) return (cl<op && cl<=midpoint);
   return false;
}

bool FindSetup(int direction,SignalSetup &setup)
{
   int maxShift=(int)MathMin(InpBOSSearchBars,InpSetupExpiryBars);
   for(int s=2; s<=maxShift; s++)
   {
      double bosClose=iClose(_Symbol,InpEntryTF,s);
      double priorHigh=HighestHigh(InpEntryTF,s+1,InpStructureLookback);
      double priorLow=LowestLow(InpEntryTF,s+1,InpStructureLookback);
      if(bosClose<=0 || priorHigh<=0 || priorLow<=0) continue;
      if(direction==1 && bosClose<=priorHigh) continue;
      if(direction==-1 && bosClose>=priorLow) continue;
      if(InpRequireLiquiditySweep && !HasSweep(direction,s)) continue;
      if(InpRequireFVG && !HasFVG(direction,s)) continue;
      double obHigh=0,obLow=0;
      datetime obTime=0;
      if(!FindOB(direction,s,obHigh,obLow,obTime)) continue;
      if(!HasRejection(direction,obHigh,obLow)) continue;
      setup.direction=direction;
      setup.bosTime=iTime(_Symbol,InpEntryTF,s);
      setup.obTime=obTime;
      setup.obHigh=obHigh;
      setup.obLow=obLow;
      return true;
   }
   return false;
}

string JsonEscape(string value)
{
   StringReplace(value,"\\","\\\\");
   StringReplace(value,"\"","\\\"");
   StringReplace(value,"\r","\\r");
   StringReplace(value,"\n","\\n");
   return value;
}

bool PublishSignal(SignalSetup &setup)
{
   MqlTick tick;
   if(!SymbolInfoTick(_Symbol,tick)) return false;
   double point=SymbolInfoDouble(_Symbol,SYMBOL_POINT);
   if(point<=0) return false;

   int digits=(int)SymbolInfoInteger(_Symbol,SYMBOL_DIGITS);
   double entry=(setup.direction==1 ? tick.ask : tick.bid);
   double sl=(setup.direction==1 ? setup.obLow-InpStopBufferPoints*point : setup.obHigh+InpStopBufferPoints*point);
   if((setup.direction==1 && sl>=entry) || (setup.direction==-1 && sl<=entry)) return false;
   double risk=MathAbs(entry-sl);
   double tp=(setup.direction==1 ? entry+risk*InpRewardRiskRatio : entry-risk*InpRewardRiskRatio);
   string side=(setup.direction==1 ? "BUY" : "SELL");
   datetime signalTime=iTime(_Symbol,InpEntryTF,1);
   string signalId=_Symbol+"_"+IntegerToString((long)signalTime)+"_"+side;

   string json="{"
      + "\"source\":\"jarvis-signal\","
      + "\"signal\":{"
      + "\"signal_id\":\""+JsonEscape(signalId)+"\","
      + "\"symbol\":\""+JsonEscape(_Symbol)+"\","
      + "\"market\":\""+JsonEscape(ClassifyMarket(_Symbol))+"\","
      + "\"direction\":\""+side+"\","
      + "\"strategy\":\"JARVIS SMC BOS OB Retest\","
      + "\"timeframe\":\""+EnumToString(InpEntryTF)+"\","
      + "\"bias_timeframe\":\""+EnumToString(InpBiasTF)+"\","
      + "\"entry\":"+DoubleToString(entry,digits)+","
      + "\"sl\":"+DoubleToString(sl,digits)+","
      + "\"tp\":"+DoubleToString(tp,digits)+","
      + "\"status\":\"CONFIRMED\","
      + "\"timestamp\":\""+FormatUtc(TimeGMT())+"\","
      + "\"setup_bar\":\""+FormatUtc(signalTime)+"\""
      + "}}";

   char requestData[],responseData[];
   string headers="Content-Type: application/json\r\n";
   string responseHeaders;
   int copied=StringToCharArray(json,requestData,0,WHOLE_ARRAY,CP_UTF8);
   if(copied>0) ArrayResize(requestData,copied-1);
   ResetLastError();
   int code=WebRequest("POST",InpApiUrl,headers,InpTimeoutMs,requestData,responseData,responseHeaders);
   if(code==-1)
   {
      Print("JARVIS signal publish failed. MT5 WebRequest error=",GetLastError());
      return false;
   }
   string responseText=CharArrayToString(responseData,0,-1,CP_UTF8);
   Print("JARVIS signal publish HTTP ",code," | ",side," ",_Symbol," | ",responseText);
   return (code>=200 && code<300);
}

string FormatUtc(datetime value)
{
   MqlDateTime dt;
   TimeToStruct(value,dt);
   return StringFormat("%04d-%02d-%02dT%02d:%02d:%02dZ",
      dt.year,dt.mon,dt.day,dt.hour,dt.min,dt.sec);
}

string ClassifyMarket(string symbol)
{
   string upper=symbol;
   StringToUpper(upper);
   if(StringFind(upper,"XAU")>=0 || StringFind(upper,"GOLD")>=0) return "gold";
   if(StringFind(upper,"VOLATILITY")>=0 || StringFind(upper,"BOOM")>=0 ||
      StringFind(upper,"CRASH")>=0 || StringFind(upper,"STEP")>=0 ||
      StringFind(upper,"JUMP")>=0 || StringFind(upper,"RANGE")>=0 ||
      StringFind(upper,"DRIFT")>=0 || StringFind(upper,"DEX")>=0 ||
      StringFind(upper,"SKEW")>=0 || StringFind(upper,"1HZ")>=0) return "synthetics";
   return "forex";
}

int OnInit()
{
   int minBias=InpBiasLookback+InpBiasSearchBars+5;
   int minEntry=InpStructureLookback+InpOBSearchBars+InpBOSSearchBars+InpSweepLookback+10;
   if(InpRewardRiskRatio<=0 || InpStopBufferPoints<0 ||
      InpBiasLookback<2 || InpStructureLookback<2 ||
      InpBiasSearchBars<1 || InpBOSSearchBars<2 || InpOBSearchBars<1)
      return INIT_PARAMETERS_INCORRECT;
   g_lastBar=iTime(_Symbol,InpEntryTF,0);
   Print("JARVIS Signal-Only SMC Publisher started on ",_Symbol,
         " | Bias=",EnumToString(InpBiasTF)," | Entry=",EnumToString(InpEntryTF),
         " | NO ORDER EXECUTION.");
   if(Bars(_Symbol,InpBiasTF)<minBias || Bars(_Symbol,InpEntryTF)<minEntry)
      Print("JARVIS signal publisher waiting for sufficient candle history.");
   return INIT_SUCCEEDED;
}

void OnTick()
{
   datetime currentBar=iTime(_Symbol,InpEntryTF,0);
   if(currentBar<=0 || currentBar==g_lastBar) return;
   g_lastBar=currentBar;
   if(TimeCurrent()-g_lastPublishTime<InpPublishCooldownSeconds) return;

   int minBias=InpBiasLookback+InpBiasSearchBars+5;
   int minEntry=InpStructureLookback+InpOBSearchBars+InpBOSSearchBars+InpSweepLookback+10;
   if(Bars(_Symbol,InpBiasTF)<minBias || Bars(_Symbol,InpEntryTF)<minEntry) return;

   int bias=GetBias();
   if(bias==0) return;
   SignalSetup setup;
   if(!FindSetup(bias,setup)) return;
   datetime signalBar=iTime(_Symbol,InpEntryTF,1);
   if(signalBar<=0 || signalBar==g_lastPublishedSignalBar) return;
   if(PublishSignal(setup))
   {
      g_lastPublishedSignalBar=signalBar;
      g_lastPublishTime=TimeCurrent();
   }
}
//+------------------------------------------------------------------+

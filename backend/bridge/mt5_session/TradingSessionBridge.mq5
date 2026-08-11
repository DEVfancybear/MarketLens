#property copyright "MarketLens"
#property version   "1.00"
#property strict

input int RefreshSeconds = 5;
input string OutputFile = "MarketLens\\market_sessions.json";

const long DAY_SECONDS = 86400;

string JsonEscape(string value)
  {
   StringReplace(value,"\\","\\\\");
   StringReplace(value,"\"","\\\"");
   StringReplace(value,"\r","\\r");
   StringReplace(value,"\n","\\n");
   StringReplace(value,"\t","\\t");
   return value;
  }

long SecondsOfDay(const datetime value)
  {
   MqlDateTime parts={};
   if(!TimeToStruct(value,parts))
      return 0;
   return (long)parts.hour*3600+(long)parts.min*60+(long)parts.sec;
  }

long SessionSeconds(const datetime value)
  {
   const long raw=(long)value;
   // Native session values are seconds from the selected weekday and may
   // extend through the following day (up to 172800). Never fold them modulo
   // one day or a cross-day exchange session is shifted backwards.
   if(raw>=0 && raw<=2*DAY_SECONDS)
      return raw;
   return SecondsOfDay(value);
  }

void AppendWindow(long &starts[],long &ends[],const long start_at,const long end_at)
  {
   const int size=ArraySize(starts);
   ArrayResize(starts,size+1);
   ArrayResize(ends,size+1);
   starts[size]=start_at;
   ends[size]=end_at;
  }

void SortWindows(long &starts[],long &ends[])
  {
   const int size=ArraySize(starts);
   for(int i=0;i<size-1;i++)
     {
      for(int j=i+1;j<size;j++)
        {
         if(starts[j]>=starts[i])
            continue;
         const long start_tmp=starts[i];
         const long end_tmp=ends[i];
         starts[i]=starts[j];
         ends[i]=ends[j];
         starts[j]=start_tmp;
         ends[j]=end_tmp;
        }
     }
  }

void MergeWindows(const long &starts[],const long &ends[],long &merged_starts[],long &merged_ends[])
  {
   ArrayResize(merged_starts,0);
   ArrayResize(merged_ends,0);
   const int size=ArraySize(starts);
   for(int i=0;i<size;i++)
     {
      const int merged_size=ArraySize(merged_starts);
      if(merged_size==0 || starts[i]>merged_ends[merged_size-1])
        {
         AppendWindow(merged_starts,merged_ends,starts[i],ends[i]);
         continue;
        }
      if(ends[i]>merged_ends[merged_size-1])
         merged_ends[merged_size-1]=ends[i];
     }
  }

bool ResolveSchedule(const string symbol,const datetime server_now,
                     bool &is_open,long &session_open,long &session_close,long &next_open)
  {
   is_open=false;
   session_open=0;
   session_close=0;
   next_open=0;

   MqlDateTime now_parts={};
   if(!TimeToStruct(server_now,now_parts))
      return false;
   const long today_start=(long)server_now-SecondsOfDay(server_now);
   long starts[];
   long ends[];
   bool found=false;

   // Include two prior weekdays because the native range can extend through
   // the following day. Eight future days guarantee the next weekly opening.
   for(int offset=-2;offset<=8;offset++)
     {
      int weekday=(now_parts.day_of_week+offset)%7;
      if(weekday<0)
         weekday+=7;
      const long day_start=today_start+(long)offset*DAY_SECONDS;
      for(uint index=0;index<32;index++)
        {
         datetime from=0;
         datetime to=0;
         if(!SymbolInfoSessionTrade(symbol,(ENUM_DAY_OF_WEEK)weekday,index,from,to))
            break;
         found=true;
         const long from_seconds=SessionSeconds(from);
         const long to_seconds=SessionSeconds(to);
         long start_at=day_start+from_seconds;
         long end_at=day_start+to_seconds;
         if(end_at<=start_at)
            end_at+=DAY_SECONDS;
         AppendWindow(starts,ends,start_at,end_at);
        }
     }

   if(!found)
      return false;

   SortWindows(starts,ends);
   long merged_starts[];
   long merged_ends[];
   MergeWindows(starts,ends,merged_starts,merged_ends);
   const int count=ArraySize(merged_starts);
   for(int i=0;i<count;i++)
     {
      if(merged_starts[i]<=(long)server_now && (long)server_now<merged_ends[i])
        {
         is_open=true;
         session_open=merged_starts[i];
         session_close=merged_ends[i];
         for(int j=i+1;j<count;j++)
           {
            if(merged_starts[j]>session_close)
              {
               next_open=merged_starts[j];
               break;
              }
           }
         return true;
        }
      if(merged_starts[i]>(long)server_now)
        {
         next_open=merged_starts[i];
         return true;
        }
     }
   return true;
  }

long ToUtc(const long server_value,const long server_now,const long utc_now)
  {
   if(server_value<=0)
      return 0;
   return utc_now+(server_value-server_now);
  }

string BuildStatus(const string symbol,const long server_now,const long utc_now,const long valid_until)
  {
   bool scheduled_open=false;
   long session_open=0;
   long session_close=0;
   long next_open=0;
   const bool has_schedule=ResolveSchedule(
      symbol,(datetime)server_now,scheduled_open,session_open,session_close,next_open
   );

   long trade_mode=SYMBOL_TRADE_MODE_DISABLED;
   const bool has_trade_mode=SymbolInfoInteger(symbol,SYMBOL_TRADE_MODE,trade_mode);
   string state="unknown";
   string reason="schedule_unavailable";
   if(has_schedule)
     {
      state=scheduled_open ? "open" : "closed";
      reason=scheduled_open ? "within_trade_session" : "outside_trade_session";
     }
   if(has_trade_mode && trade_mode==SYMBOL_TRADE_MODE_DISABLED)
     {
      state="closed";
      scheduled_open=false;
      reason="trade_disabled";
     }

   long contract_start=0;
   long contract_expiration=0;
   const bool has_contract_start=SymbolInfoInteger(symbol,SYMBOL_START_TIME,contract_start);
   const bool has_contract_expiration=SymbolInfoInteger(
      symbol,SYMBOL_EXPIRATION_TIME,contract_expiration
   );
   if(has_contract_start && contract_start>0 && server_now<contract_start)
     {
      state="closed";
      scheduled_open=false;
      reason="contract_not_started";
      session_open=0;
      session_close=0;
      next_open=0;
     }
   if(has_contract_expiration && contract_expiration>0)
     {
      if(server_now>=contract_expiration)
        {
         state="closed";
         scheduled_open=false;
         reason="contract_expired";
         session_open=0;
         session_close=0;
         next_open=0;
        }
      else
        {
         if(state=="open" && session_close>contract_expiration)
            session_close=contract_expiration;
         if(state=="closed" && next_open>=contract_expiration)
            next_open=0;
        }
     }

   const long open_utc=ToUtc(session_open,server_now,utc_now);
   const long close_utc=ToUtc(session_close,server_now,utc_now);
   const long next_open_utc=ToUtc(next_open,server_now,utc_now);
   const long next_transition=(state=="open" ? close_utc : next_open_utc);
   return StringFormat(
      "{\"symbol\":\"%s\",\"state\":\"%s\",\"scheduled_open\":%s,"
      "\"reason\":\"%s\",\"session_open_at\":%I64d,\"session_close_at\":%I64d,"
      "\"next_open_at\":%I64d,\"next_transition_at\":%I64d,\"server_time\":%I64d,"
      "\"observed_at\":%I64d,\"valid_until\":%I64d}",
      JsonEscape(symbol),state,(scheduled_open ? "true" : "false"),reason,
      open_utc,close_utc,next_open_utc,next_transition,utc_now,utc_now,valid_until
   );
  }

string BuildUnknownStatus(const string symbol,const string reason,
                          const long utc_now,const long valid_until)
  {
   return StringFormat(
      "{\"symbol\":\"%s\",\"state\":\"unknown\",\"scheduled_open\":false,"
      "\"reason\":\"%s\",\"session_open_at\":0,\"session_close_at\":0,"
      "\"next_open_at\":0,\"next_transition_at\":0,\"server_time\":%I64d,"
      "\"observed_at\":%I64d,\"valid_until\":%I64d}",
      JsonEscape(symbol),JsonEscape(reason),utc_now,utc_now,valid_until
   );
  }

bool PublishStatuses()
  {
   const long utc_now=(long)TimeGMT();
   if(utc_now<=0)
      return false;

   const int refresh=MathMax(1,RefreshSeconds);
   const long valid_until=utc_now+(long)MathMax(15,refresh*3);
   const bool terminal_connected=(bool)TerminalInfoInteger(TERMINAL_CONNECTED);
   const long server_now=(long)TimeTradeServer();
   const bool server_clock_ready=server_now>0;
   string payload=StringFormat(
      "{\"type\":\"market_status\",\"source\":\"mt5-mql5-session\","
      "\"observed_at\":%I64d,\"valid_until\":%I64d,\"statuses\":[",
      utc_now,valid_until
   );
   const int total=SymbolsTotal(true);
   bool first=true;
   for(int i=0;i<total;i++)
     {
      const string symbol=SymbolName(i,true);
      if(symbol=="")
         continue;
      if(!first)
         payload+=",";
      if(!terminal_connected)
         payload+=BuildUnknownStatus(symbol,"terminal_disconnected",utc_now,valid_until);
      else if(!server_clock_ready)
         payload+=BuildUnknownStatus(symbol,"server_time_unavailable",utc_now,valid_until);
      else
         payload+=BuildStatus(symbol,server_now,utc_now,valid_until);
      first=false;
     }
   payload+="]}";

   FolderCreate("MarketLens",FILE_COMMON);
   const int handle=FileOpen(
      OutputFile,
      FILE_WRITE|FILE_TXT|FILE_ANSI|FILE_COMMON,
      0,
      CP_UTF8
   );
   if(handle==INVALID_HANDLE)
     {
      PrintFormat("TradingSessionBridge FileOpen failed error=%d file=%s",GetLastError(),OutputFile);
      return false;
     }
   FileWriteString(handle,payload);
   FileFlush(handle);
   FileClose(handle);
   return true;
  }

int OnInit()
  {
   const int refresh=MathMax(1,RefreshSeconds);
   if(!PublishStatuses())
      Print("TradingSessionBridge initial publish is unavailable");
   EventSetTimer(refresh);
   return INIT_SUCCEEDED;
  }

void OnTimer()
  {
   PublishStatuses();
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
  }

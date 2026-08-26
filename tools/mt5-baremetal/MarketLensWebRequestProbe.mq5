#property copyright "MarketLens"
#property version   "1.00"
#property strict

#define PROBE_URL "http://127.0.0.1:8790/health"
#define REQUEST_FILE "MarketLens\\webrequest-probe-request.txt"

bool IsLowerHexNonce(const string value)
  {
   if(StringLen(value)!=32)
      return false;
   for(int index=0; index<32; index++)
     {
      ushort character=StringGetCharacter(value,index);
      if(!((character>='0' && character<='9') ||
           (character>='a' && character<='f')))
         return false;
     }
   return true;
  }

bool ReadProbeRequest(string &nonce,long &requested_at_unix)
  {
   ResetLastError();
   int handle=FileOpen(REQUEST_FILE,FILE_READ|FILE_TXT|FILE_ANSI|FILE_COMMON,0,CP_UTF8);
   if(handle==INVALID_HANDLE)
     {
      PrintFormat("PROBE_REQUEST_OPEN_FAILED error=%d",GetLastError());
      return false;
     }

   string schema_line=FileReadString(handle);
   string nonce_line=FileReadString(handle);
   string url_line=FileReadString(handle);
   string timestamp_line=FileReadString(handle);
   bool has_extra=!FileIsEnding(handle);
   FileClose(handle);

   if(schema_line!="schemaVersion=1" ||
      StringFind(nonce_line,"nonce=")!=0 ||
      url_line!="url="+PROBE_URL ||
      StringFind(timestamp_line,"requestedAtUnix=")!=0 || has_extra)
     {
      Print("PROBE_REQUEST_INVALID");
      return false;
     }

   nonce=StringSubstr(nonce_line,StringLen("nonce="));
   requested_at_unix=(long)StringToInteger(
      StringSubstr(timestamp_line,StringLen("requestedAtUnix=")));
   if(!IsLowerHexNonce(nonce) || requested_at_unix<=0)
     {
      Print("PROBE_REQUEST_INVALID");
      return false;
     }
   return true;
  }

bool WriteProbeReceipt(const string nonce,
                       const long requested_at_unix,
                       const int http_status,
                       const int mt5_error,
                       const int terminal_build,
                       const long observed_at_unix,
                       const bool response_ok,
                       const bool response_service,
                       const bool response_protocol,
                       const bool probe_succeeded)
  {
   string path="MarketLens\\webrequest-probe-"+nonce+".json";
   ResetLastError();
   int handle=FileOpen(path,FILE_WRITE|FILE_TXT|FILE_ANSI|FILE_COMMON,0,CP_UTF8);
   if(handle==INVALID_HANDLE)
     {
      PrintFormat("PROBE_RECEIPT_OPEN_FAILED error=%d",GetLastError());
      return false;
     }

   string receipt=StringFormat(
      "{\"schemaVersion\":1,\"nonce\":\"%s\",\"url\":\"%s\","
      "\"httpStatus\":%d,\"mt5Error\":%d,\"terminalBuild\":%d,"
      "\"requestedAtUnix\":%I64d,\"observedAtUnix\":%I64d,"
      "\"responseOk\":%s,\"responseService\":%s,"
      "\"responseProtocol\":%s,\"probeSucceeded\":%s}",
      nonce,PROBE_URL,http_status,mt5_error,terminal_build,
      requested_at_unix,observed_at_unix,
      response_ok ? "true" : "false",
      response_service ? "true" : "false",
      response_protocol ? "true" : "false",
      probe_succeeded ? "true" : "false");
   uint written=FileWriteString(handle,receipt);
   FileFlush(handle);
   FileClose(handle);
   return written>0;
  }

void OnStart()
  {
   string nonce="";
   long requested_at_unix=0;
   if(!ReadProbeRequest(nonce,requested_at_unix))
      return;

   char request[];
   char response[];
   ArrayResize(request,0);
   string response_headers="";
   ResetLastError();
   int http_status=WebRequest("GET", PROBE_URL,
                              "Accept: application/json\r\n",
                              5000,request,response,response_headers);
   int mt5_error=(http_status==-1 ? GetLastError() : 0);
   string body=CharArrayToString(response,0,-1,CP_UTF8);
   bool response_ok=(StringFind(body,"\"ok\":true")>=0);
   bool response_service=(StringFind(body,"\"service\":\"execution-gateway\"")>=0);
   bool response_protocol=(StringFind(body,"\"protocolVersion\":1")>=0);
   bool probe_succeeded=(http_status==200 && response_ok &&
                         response_service && response_protocol);
   long observed_at_unix=(long)TimeLocal();
   int terminal_build=(int)TerminalInfoInteger(TERMINAL_BUILD);

   if(!WriteProbeReceipt(nonce,requested_at_unix,http_status,mt5_error,
                         terminal_build,observed_at_unix,response_ok,
                         response_service,response_protocol,probe_succeeded))
      return;

   PrintFormat("MARKETLENS_WEBREQUEST_PROBE status=%d error=%d success=%s",
               http_status,mt5_error,probe_succeeded ? "true" : "false");
  }

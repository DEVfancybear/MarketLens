#property copyright "SMC Trading Terminal"
#property version   "1.23"
#property strict
#property description "Broker-neutral MT5 execution agent for the Rust execution gateway."

input string GatewayUrl       = "http://127.0.0.1:8790";
input string PairingToken     = "";
input int    PollIntervalMs   = 750;
input int    HttpTimeoutMs    = 5000;
input long   MagicNumber      = 26072026;

const int PROTOCOL_VERSION = 1;
const string EA_VERSION = "1.23";
const int MAX_BUFFERED_EVENTS = 128;
const int MAX_JOURNAL_COMMANDS = 4096;
const int MAX_INSTRUMENTS_PER_HEARTBEAT = 32;
const int MAX_PORTFOLIO_ITEMS_PER_HEARTBEAT = 200;

string g_session_token = "";
string g_account_id = "";
string g_agent_id = "";
string g_events[];
string g_command_ids[];
string g_command_states[];
string g_command_orders[];
string g_command_deals[];
ulong g_command_retcodes[];
ulong g_command_times[];
string g_command_messages[];
ulong g_last_snapshot_at = 0;
bool g_request_in_flight = false;
int g_instrument_cursor = 0;
ulong g_gateway_time_at_sync_ms = 0;
ulong g_gateway_time_sync_tick_ms = 0;
int g_portfolio_failure_count = 0;
int g_event_failure_count = 0;
int g_instrument_failure_count = 0;
ulong g_next_portfolio_retry_at = 0;
ulong g_next_event_retry_at = 0;
ulong g_next_instrument_retry_at = 0;
ulong g_last_instrument_snapshot_at = 0;

int OnInit()
{
   if(StringLen(GatewayUrl) == 0)
   {
      Print("SMCExecutionEA: GatewayUrl is required.");
      return INIT_PARAMETERS_INCORRECT;
   }
   if(!IsSecureGatewayUrl(GatewayUrl))
   {
      Print("SMCExecutionEA: public GatewayUrl must use HTTPS. Plain HTTP is allowed only for loopback development.");
      return INIT_PARAMETERS_INCORRECT;
   }

   g_agent_id = StringFormat("mt5-%I64d-%s", AccountInfoInteger(ACCOUNT_LOGIN),
                             TerminalInfoString(TERMINAL_DATA_PATH));
   ArrayResize(g_events, 0);
   LoadCommandJournal();
   LoadSessionCache();
   if(g_session_token == "" && StringLen(PairingToken) == 0)
   {
      Print("SMCExecutionEA: a one-time PairingToken is required for the first connection.");
      return INIT_PARAMETERS_INCORRECT;
   }

   int interval = MathMax(250, MathMin(PollIntervalMs, 5000));
   if(!EventSetMillisecondTimer(interval))
   {
      PrintFormat("SMCExecutionEA: cannot start timer, error=%d", GetLastError());
      return INIT_FAILED;
   }

   Print("SMCExecutionEA: started. Add GatewayUrl to Tools > Options > Expert Advisors > Allow WebRequest.");
   return INIT_SUCCEEDED;
}

bool IsSecureGatewayUrl(const string url)
{
   if(StringFind(url, "@") >= 0 ||
      StringFind(url, "?") >= 0 ||
      StringFind(url, "#") >= 0 ||
      StringFind(url, "\\") >= 0)
      return false;

   if(StringFind(url, "https://") == 0)
      return true;

   return IsLoopbackHttpUrl(url, "127.0.0.1") ||
          IsLoopbackHttpUrl(url, "localhost") ||
          IsLoopbackHttpUrl(url, "[::1]");
}

bool IsLoopbackHttpUrl(const string url, const string host)
{
   string prefix = "http://" + host;
   if(url == prefix || StringFind(url, prefix + "/") == 0)
      return true;
   if(StringFind(url, prefix + ":") != 0)
      return false;

   int port_start = StringLen(prefix) + 1;
   int length = StringLen(url);
   if(port_start >= length)
      return false;
   for(int index = port_start; index < length; index++)
   {
      ushort character = StringGetCharacter(url, index);
      if(character == '/')
         return index > port_start;
      if(character < '0' || character > '9')
         return false;
   }
   return true;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void OnTimer()
{
   if(g_request_in_flight)
      return;

   g_request_in_flight = true;
   if(g_session_token == "")
   {
      RegisterSession();
      g_request_in_flight = false;
      return;
   }

   // Poll first so every event and heartbeat uses the gateway's UTC clock.
   // This also lets command outcomes be acknowledged in the same timer cycle.
   PollCommands();
   if(g_session_token == "")
   {
      g_request_in_flight = false;
      return;
   }

   // An empty event batch is also the account heartbeat. This keeps account
   // identity and equity fresh without running HTTP inside trade callbacks.
   ulong monotonic_now = GetTickCount64();
   bool portfolio_due =
      ArraySize(g_events) > 0 ||
      monotonic_now - g_last_snapshot_at >= 10000;
   if(portfolio_due && monotonic_now >= g_next_portfolio_retry_at)
      FlushPortfolioSnapshot();
   if(ArraySize(g_events) > 0 &&
      monotonic_now >= g_next_event_retry_at)
      FlushBufferedEvents();
   if(monotonic_now - g_last_instrument_snapshot_at >= 10000 &&
      monotonic_now >= g_next_instrument_retry_at)
      FlushInstrumentSnapshots();
   g_request_in_flight = false;
}

void OnTradeTransaction(const MqlTradeTransaction &transaction,
                        const MqlTradeRequest &request,
                        const MqlTradeResult &result)
{
   // MT5 can emit many, unordered transaction callbacks for one request.
   // Keep this handler bounded and defer network I/O to OnTimer.
   string event_json = StringFormat(
      "{\"type\":\"tradeTransaction\",\"brokerOrderId\":%s,"
      "\"brokerDealId\":%s,\"brokerPositionId\":%s,"
      "\"transactionType\":\"%s\",\"occurredAtMs\":%I64u}",
      JsonNullableUlong(transaction.order),
      JsonNullableUlong(transaction.deal),
      JsonNullableUlong(transaction.position),
      JsonEscape(EnumToString(transaction.type)),
      EpochMilliseconds()
   );
   BufferEvent(event_json);
}

bool RegisterSession()
{
   string body = StringFormat(
      "{\"protocolVersion\":%d,\"pairingToken\":\"%s\","
      "\"agentId\":\"%s\",\"account\":%s}",
      PROTOCOL_VERSION,
      JsonEscape(PairingToken),
      JsonEscape(g_agent_id),
      AccountSnapshotJson()
   );

   string response;
   int status = HttpJson("POST", "/v1/ea/sessions", body, "", response);
   if(status < 200 || status >= 300)
   {
      PrintFormat("SMCExecutionEA: pairing failed, HTTP=%d", status);
      return false;
   }

   string protocol;
   string session_token;
   string account_id;
   if(!JsonNumber(response, "protocolVersion", protocol) ||
      (int)StringToInteger(protocol) != PROTOCOL_VERSION ||
      !JsonString(response, "sessionToken", session_token) ||
      !JsonString(response, "accountId", account_id))
   {
      Print("SMCExecutionEA: invalid session response.");
      return false;
   }

   SyncGatewayClockFromJson(response);
   g_session_token = session_token;
   g_account_id = account_id;
   if(!SaveSessionCache())
   {
      g_session_token = "";
      g_account_id = "";
      Print("SMCExecutionEA: paired session could not be persisted; refusing ephemeral execution.");
      return false;
   }
   g_last_snapshot_at = 0;
   PrintFormat("SMCExecutionEA: paired account %s.", g_account_id);
   return true;
}

void PollCommands()
{
   string response;
   int status = HttpJson("POST", "/v1/ea/poll", "", g_session_token, response);
   if(status == 401)
   {
      ResetSession("session expired");
      return;
   }
   if(status < 200 || status >= 300)
   {
      LogHttpFailure("poll", status, response);
      return;
   }

   SyncGatewayClockFromJson(response);
   int cursor = 0;
   int command_count = 0;
   string command;
   while(NextCommandObject(response, cursor, command))
   {
      command_count++;
      string type;
      if(!JsonString(command, "type", type))
      {
         Print("SMCExecutionEA: ignored command without a type.");
         continue;
      }
      if(type == "place")
         ExecutePlaceCommand(command);
      else if(type == "modifyPosition")
         ExecuteModifyPositionCommand(command);
      else if(type == "closePosition")
         ExecuteClosePositionCommand(command);
      else if(type == "cancelOrder")
         ExecuteCancelOrderCommand(command);
      else if(type == "sync")
         g_last_snapshot_at = 0;
      else
         PrintFormat("SMCExecutionEA: ignored unsupported command type '%s'.",
                     type);
   }
   if(command_count > 0)
      PrintFormat("SMCExecutionEA: processed %d gateway command(s).",
                  command_count);
}

void ExecutePlaceCommand(const string command)
{
   string command_id;
   string target_account_id;
   string symbol;
   string side;
   string kind;
   string quantity_text;
   if(!JsonString(command, "commandId", command_id) ||
      !JsonString(command, "targetAccountId", target_account_id) ||
      !JsonString(command, "venueSymbol", symbol) ||
      !JsonString(command, "side", side) ||
      !JsonString(command, "kind", kind) ||
      !JsonString(command, "quantity", quantity_text))
   {
      BufferRejected(command_id, 0, "Malformed place command");
      return;
   }
   if(target_account_id != g_account_id)
   {
      BufferRejected(command_id, 0, "Target account does not match this EA session");
      return;
   }
   if(CommandWasSeen(command_id))
   {
      ReplayRecordedOutcome(command_id);
      return;
   }

   if(!MQLInfoInteger(MQL_TRADE_ALLOWED) ||
      !TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) ||
      !AccountInfoInteger(ACCOUNT_TRADE_ALLOWED))
   {
      RecordCommandState(command_id, "rejected", 0, 0, 0,
                         "MT5 automated trading is not allowed");
      BufferRejected(command_id, 0, "MT5 automated trading is not allowed");
      return;
   }
   if(!SymbolSelect(symbol, true))
   {
      RecordCommandState(command_id, "rejected", 0, 0, 0,
                         "Venue symbol is unavailable");
      BufferRejected(command_id, 0, "Venue symbol is unavailable");
      return;
   }

   MqlTradeRequest request = {};
   MqlTradeCheckResult check = {};
   MqlTradeResult result = {};
   request.magic = (ulong)MagicNumber;
   request.symbol = symbol;
   request.volume = StringToDouble(quantity_text);
   request.deviation = 20;
   request.type_time = ORDER_TIME_GTC;
   request.type_filling = ResolveFillingMode(symbol);
   request.comment = CommandComment(command_id);

   string limit_price;
   string stop_price;
   string stop_loss;
   string take_profit;
   bool has_limit = JsonString(command, "limitPrice", limit_price);
   bool has_stop = JsonString(command, "stopPrice", stop_price);
   bool has_sl = JsonString(command, "stopLoss", stop_loss);
   bool has_tp = JsonString(command, "takeProfit", take_profit);
   if(has_sl)
      request.sl = NormalizeDouble(StringToDouble(stop_loss),
                                   (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS));
   if(has_tp)
      request.tp = NormalizeDouble(StringToDouble(take_profit),
                                   (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS));

   if(kind == "market")
   {
      request.action = TRADE_ACTION_DEAL;
      request.type = side == "buy" ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
      request.price = SymbolInfoDouble(
         symbol, side == "buy" ? SYMBOL_ASK : SYMBOL_BID);
   }
   else if(kind == "limit" && has_limit)
   {
      request.action = TRADE_ACTION_PENDING;
      request.type = side == "buy" ? ORDER_TYPE_BUY_LIMIT : ORDER_TYPE_SELL_LIMIT;
      request.price = StringToDouble(limit_price);
   }
   else if(kind == "stop" && has_stop)
   {
      request.action = TRADE_ACTION_PENDING;
      request.type = side == "buy" ? ORDER_TYPE_BUY_STOP : ORDER_TYPE_SELL_STOP;
      request.price = StringToDouble(stop_price);
   }
   else
   {
      RecordCommandState(command_id, "rejected", 0, 0, 0,
                         "Unsupported order type or missing entry price");
      BufferRejected(command_id, 0, "Unsupported order type or missing entry price");
      return;
   }

   ResetLastError();
   if(!OrderCheck(request, check))
   {
      ulong check_error = (ulong)GetLastError();
      RecordCommandState(command_id, "rejected", 0, 0, check_error,
                         "OrderCheck failed before broker submission");
      BufferRejected(command_id, check_error, "OrderCheck failed before broker submission");
      return;
   }

   // Persist the ambiguous boundary before calling the broker. On restart an
   // unresolved "submitting" record is reconciled from MT5 orders/history and
   // is never blindly submitted again.
   if(!RecordCommandState(command_id, "submitting", 0, 0, 0,
                          "Awaiting broker result"))
   {
      BufferRejected(command_id, 0,
                     "Local idempotency journal is unavailable; order was not sent");
      return;
   }
   if(!OrderSend(request, result))
   {
      RecordCommandState(command_id, "rejected", result.order, result.deal,
                         result.retcode, "OrderSend failed before broker acceptance");
      BufferRejected(command_id, result.retcode,
                     "OrderSend failed before broker acceptance");
      return;
   }

   if(result.retcode != TRADE_RETCODE_DONE &&
      result.retcode != TRADE_RETCODE_PLACED &&
      result.retcode != TRADE_RETCODE_DONE_PARTIAL)
   {
      RecordCommandState(command_id, "rejected", result.order, result.deal,
                         result.retcode, result.comment);
      BufferRejected(command_id, result.retcode, result.comment);
      return;
   }

   RecordCommandState(command_id, "accepted", result.order, result.deal,
                      result.retcode, result.comment);
   BufferAccepted(command_id, result.order, result.deal,
                  result.retcode, result.comment, EpochMilliseconds());
}

bool ValidateDirectCommand(const string command, string &command_id,
                           string &target_account_id)
{
   if(!JsonString(command, "commandId", command_id) ||
      !JsonString(command, "targetAccountId", target_account_id))
   {
      BufferRejected(command_id, 0, "Malformed execution command");
      return false;
   }
   if(target_account_id != g_account_id)
   {
      BufferRejected(command_id, 0, "Target account does not match this EA session");
      return false;
   }
   if(CommandWasSeen(command_id))
   {
      ReplayRecordedOutcome(command_id);
      return false;
   }
   if(!MQLInfoInteger(MQL_TRADE_ALLOWED) ||
      !TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) ||
      !AccountInfoInteger(ACCOUNT_TRADE_ALLOWED))
   {
      RecordCommandState(command_id, "rejected", 0, 0, 0,
                         "MT5 automated trading is not allowed");
      BufferRejected(command_id, 0, "MT5 automated trading is not allowed");
      return false;
   }
   return true;
}

void SubmitDirectCommand(const string command_id, MqlTradeRequest &request)
{
   MqlTradeCheckResult check = {};
   MqlTradeResult result = {};
   ResetLastError();
   if(!OrderCheck(request, check))
   {
      ulong check_error = (ulong)GetLastError();
      RecordCommandState(command_id, "rejected", 0, 0, check_error,
                         "OrderCheck failed before broker submission");
      BufferRejected(command_id, check_error,
                     "OrderCheck failed before broker submission");
      return;
   }
   if(!RecordCommandState(command_id, "submitting", 0, 0, 0,
                          "Awaiting broker result"))
   {
      BufferRejected(command_id, 0,
                     "Local idempotency journal is unavailable; command was not sent");
      return;
   }
   if(!OrderSend(request, result))
   {
      RecordCommandState(command_id, "rejected", result.order, result.deal,
                         result.retcode, "OrderSend failed before broker acceptance");
      BufferRejected(command_id, result.retcode,
                     "OrderSend failed before broker acceptance");
      return;
   }
   if(result.retcode != TRADE_RETCODE_DONE &&
      result.retcode != TRADE_RETCODE_PLACED &&
      result.retcode != TRADE_RETCODE_DONE_PARTIAL)
   {
      RecordCommandState(command_id, "rejected", result.order, result.deal,
                         result.retcode, result.comment);
      BufferRejected(command_id, result.retcode, result.comment);
      return;
   }
   RecordCommandState(command_id, "accepted", result.order, result.deal,
                      result.retcode, result.comment);
   BufferAccepted(command_id, result.order, result.deal,
                  result.retcode, result.comment, EpochMilliseconds());
   g_last_snapshot_at = 0;
}

void ExecuteModifyPositionCommand(const string command)
{
   string command_id;
   string target_account_id;
   if(!ValidateDirectCommand(command, command_id, target_account_id))
      return;
   string position_id;
   if(!JsonString(command, "brokerPositionId", position_id))
   {
      RecordCommandState(command_id, "rejected", 0, 0, 0,
                         "Position ticket is missing");
      BufferRejected(command_id, 0, "Position ticket is missing");
      return;
   }
   ulong ticket = (ulong)StringToInteger(position_id);
   if(ticket == 0 || !PositionSelectByTicket(ticket))
   {
      RecordCommandState(command_id, "rejected", 0, 0, 0,
                         "Position was not found");
      BufferRejected(command_id, 0, "Position was not found");
      return;
   }
   string stop_loss;
   string take_profit;
   bool has_stop = JsonString(command, "stopLoss", stop_loss);
   bool has_target = JsonString(command, "takeProfit", take_profit);
   if(!has_stop && !has_target)
   {
      RecordCommandState(command_id, "rejected", 0, 0, 0,
                         "Position modification is empty");
      BufferRejected(command_id, 0, "Position modification is empty");
      return;
   }
   string symbol = PositionGetString(POSITION_SYMBOL);
   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   MqlTradeRequest request = {};
   request.action = TRADE_ACTION_SLTP;
   request.position = ticket;
   request.symbol = symbol;
   request.magic = (ulong)MagicNumber;
   request.sl = has_stop
      ? NormalizeDouble(StringToDouble(stop_loss), digits)
      : PositionGetDouble(POSITION_SL);
   request.tp = has_target
      ? NormalizeDouble(StringToDouble(take_profit), digits)
      : PositionGetDouble(POSITION_TP);
   SubmitDirectCommand(command_id, request);
}

void ExecuteClosePositionCommand(const string command)
{
   string command_id;
   string target_account_id;
   if(!ValidateDirectCommand(command, command_id, target_account_id))
      return;
   string position_id;
   if(!JsonString(command, "brokerPositionId", position_id))
   {
      RecordCommandState(command_id, "rejected", 0, 0, 0,
                         "Position ticket is missing");
      BufferRejected(command_id, 0, "Position ticket is missing");
      return;
   }
   ulong ticket = (ulong)StringToInteger(position_id);
   if(ticket == 0 || !PositionSelectByTicket(ticket))
   {
      RecordCommandState(command_id, "rejected", 0, 0, 0,
                         "Position was not found");
      BufferRejected(command_id, 0, "Position was not found");
      return;
   }
   string symbol = PositionGetString(POSITION_SYMBOL);
   double current_volume = PositionGetDouble(POSITION_VOLUME);
   string quantity_text;
   double volume = JsonString(command, "quantity", quantity_text)
      ? StringToDouble(quantity_text)
      : current_volume;
   double step = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
   double minimum = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
   if(step <= 0)
      step = minimum;
   volume = MathMin(current_volume, MathFloor(volume / step + 1e-9) * step);
   if(volume < minimum || volume <= 0)
   {
      RecordCommandState(command_id, "rejected", 0, 0, 0,
                         "Close quantity is below the broker minimum");
      BufferRejected(command_id, 0, "Close quantity is below the broker minimum");
      return;
   }
   ENUM_POSITION_TYPE position_type =
      (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
   string deviation_text;
   int deviation = JsonNumber(command, "deviationPoints", deviation_text)
      ? (int)StringToInteger(deviation_text)
      : 20;
   MqlTradeRequest request = {};
   request.action = TRADE_ACTION_DEAL;
   request.position = ticket;
   request.symbol = symbol;
   request.magic = (ulong)MagicNumber;
   request.volume = volume;
   request.deviation = (ulong)MathMax(0, MathMin(deviation, 10000));
   request.type = position_type == POSITION_TYPE_BUY
      ? ORDER_TYPE_SELL
      : ORDER_TYPE_BUY;
   request.price = SymbolInfoDouble(
      symbol, request.type == ORDER_TYPE_BUY ? SYMBOL_ASK : SYMBOL_BID);
   request.type_filling = ResolveFillingMode(symbol);
   request.comment = CommandComment(command_id);
   SubmitDirectCommand(command_id, request);
}

void ExecuteCancelOrderCommand(const string command)
{
   string command_id;
   string target_account_id;
   if(!ValidateDirectCommand(command, command_id, target_account_id))
      return;
   string order_id;
   if(!JsonString(command, "brokerOrderId", order_id))
   {
      RecordCommandState(command_id, "rejected", 0, 0, 0,
                         "Pending order ticket is missing");
      BufferRejected(command_id, 0, "Pending order ticket is missing");
      return;
   }
   ulong ticket = (ulong)StringToInteger(order_id);
   if(ticket == 0 || !OrderSelect(ticket))
   {
      RecordCommandState(command_id, "rejected", 0, 0, 0,
                         "Pending order was not found");
      BufferRejected(command_id, 0, "Pending order was not found");
      return;
   }
   MqlTradeRequest request = {};
   request.action = TRADE_ACTION_REMOVE;
   request.order = ticket;
   request.symbol = OrderGetString(ORDER_SYMBOL);
   request.magic = (ulong)MagicNumber;
   request.comment = CommandComment(command_id);
   SubmitDirectCommand(command_id, request);
}

string BufferedEventsJson()
{
   string output = "[";
   int event_count = ArraySize(g_events);
   for(int index = 0; index < event_count; index++)
   {
      if(index > 0)
         output += ",";
      output += g_events[index];
   }
   output += "]";
   return output;
}

int PostEventBatch(const string operation,
                   const string instruments_json,
                   const string positions_json,
                   const string pending_orders_json,
                   const bool portfolio_complete,
                   const string events_json)
{
   string body = StringFormat(
      "{\"protocolVersion\":%d,\"account\":%s,"
      "\"instruments\":%s,\"positions\":%s,\"pendingOrders\":%s,"
      "\"portfolioSnapshotComplete\":%s,\"events\":%s}",
      PROTOCOL_VERSION, AccountSnapshotJson(), instruments_json,
      positions_json, pending_orders_json,
      portfolio_complete ? "true" : "false", events_json);
   string response;
   int status = HttpJson("POST", "/v1/ea/events", body, g_session_token, response);
   if(status == 401)
   {
      ResetSession("session expired while sending " + operation);
      return status;
   }
   if(status < 200 || status >= 300)
      LogHttpFailure(operation, status, response);
   return status;
}

ulong RetryDelayMs(const int failure_count)
{
   int exponent = MathMin(MathMax(failure_count - 1, 0), 5);
   return (ulong)(1000 * (1 << exponent));
}

void FlushPortfolioSnapshot()
{
   string positions_json = PositionSnapshotsJson();
   string pending_orders_json = PendingOrderSnapshotsJson();
   bool portfolio_complete =
      PositionsTotal() <= MAX_PORTFOLIO_ITEMS_PER_HEARTBEAT &&
      OrdersTotal() <= MAX_PORTFOLIO_ITEMS_PER_HEARTBEAT;
   int status = PostEventBatch(
      "portfolio sync", "[]", positions_json, pending_orders_json,
      portfolio_complete, "[]");
   if(status == 401)
      return;
   if(status < 200 || status >= 300)
   {
      g_portfolio_failure_count++;
      g_next_portfolio_retry_at =
         GetTickCount64() + RetryDelayMs(g_portfolio_failure_count);
      return;
   }
   g_last_snapshot_at = GetTickCount64();
   g_portfolio_failure_count = 0;
   g_next_portfolio_retry_at = 0;
}

void FlushBufferedEvents()
{
   int event_count = ArraySize(g_events);
   if(event_count == 0)
      return;
   int status = PostEventBatch(
      "command event sync", "[]", "[]", "[]", false,
      BufferedEventsJson());
   if(status == 401)
      return;
   if(status < 200 || status >= 300)
   {
      g_event_failure_count++;
      g_next_event_retry_at =
         GetTickCount64() + RetryDelayMs(g_event_failure_count);
      return;
   }
   ArrayResize(g_events, 0);
   g_event_failure_count = 0;
   g_next_event_retry_at = 0;
}

void FlushInstrumentSnapshots()
{
   int status = PostEventBatch(
      "instrument sync", InstrumentSnapshotsJson(), "[]", "[]",
      false, "[]");
   if(status == 401)
      return;
   if(status < 200 || status >= 300)
   {
      g_instrument_failure_count++;
      g_next_instrument_retry_at =
         GetTickCount64() + RetryDelayMs(g_instrument_failure_count);
      return;
   }
   g_last_instrument_snapshot_at = GetTickCount64();
   g_instrument_failure_count = 0;
   g_next_instrument_retry_at = 0;
}

string PositionSnapshotsJson()
{
   string output = "[";
   int total = MathMin(PositionsTotal(), MAX_PORTFOLIO_ITEMS_PER_HEARTBEAT);
   int appended = 0;
   ulong observed_at = EpochMilliseconds();
   for(int index = 0; index < total; index++)
   {
      ulong ticket = PositionGetTicket(index);
      if(ticket == 0)
         continue;
      string symbol = PositionGetString(POSITION_SYMBOL);
      ENUM_POSITION_TYPE position_type =
         (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
      string side = position_type == POSITION_TYPE_BUY ? "buy" : "sell";
      double stop_loss = PositionGetDouble(POSITION_SL);
      double take_profit = PositionGetDouble(POSITION_TP);
      string stop_json =
         stop_loss > 0 ? "\"" + DecimalText(stop_loss) + "\"" : "null";
      string target_json =
         take_profit > 0 ? "\"" + DecimalText(take_profit) + "\"" : "null";
      string snapshot = StringFormat(
         "{\"brokerPositionId\":\"%I64u\",\"canonicalSymbol\":\"%s\","
         "\"venueSymbol\":\"%s\",\"side\":\"%s\",\"quantity\":\"%s\","
         "\"openPrice\":\"%s\",\"currentPrice\":\"%s\",\"stopLoss\":%s,"
         "\"takeProfit\":%s,\"profit\":\"%s\",\"swap\":\"%s\","
         "\"commission\":\"0\",\"magic\":%I64d,\"comment\":\"%s\","
         "\"openedAtMs\":%I64u,\"observedAtMs\":%I64u}",
         ticket, JsonEscape(symbol), JsonEscape(symbol), side,
         DecimalText(PositionGetDouble(POSITION_VOLUME)),
         DecimalText(PositionGetDouble(POSITION_PRICE_OPEN)),
         DecimalText(PositionGetDouble(POSITION_PRICE_CURRENT)),
         stop_json, target_json,
         DecimalText(PositionGetDouble(POSITION_PROFIT)),
         DecimalText(PositionGetDouble(POSITION_SWAP)),
         PositionGetInteger(POSITION_MAGIC),
         JsonEscape(PositionGetString(POSITION_COMMENT)),
         NormalizeBrokerTimestampMs(
            (ulong)PositionGetInteger(POSITION_TIME_MSC)),
         observed_at);
      if(appended > 0)
         output += ",";
      output += snapshot;
      appended++;
   }
   output += "]";
   return output;
}

string PendingOrderSnapshotsJson()
{
   string output = "[";
   int total = MathMin(OrdersTotal(), MAX_PORTFOLIO_ITEMS_PER_HEARTBEAT);
   int appended = 0;
   ulong observed_at = EpochMilliseconds();
   for(int index = 0; index < total; index++)
   {
      ulong ticket = OrderGetTicket(index);
      if(ticket == 0)
         continue;
      ENUM_ORDER_TYPE order_type = (ENUM_ORDER_TYPE)OrderGetInteger(ORDER_TYPE);
      string side = "";
      string kind = "";
      if(order_type == ORDER_TYPE_BUY_LIMIT || order_type == ORDER_TYPE_BUY_STOP ||
         order_type == ORDER_TYPE_BUY_STOP_LIMIT)
         side = "buy";
      else if(order_type == ORDER_TYPE_SELL_LIMIT || order_type == ORDER_TYPE_SELL_STOP ||
              order_type == ORDER_TYPE_SELL_STOP_LIMIT)
         side = "sell";
      if(order_type == ORDER_TYPE_BUY_LIMIT || order_type == ORDER_TYPE_SELL_LIMIT)
         kind = "limit";
      else if(side != "")
         kind = "stop";
      if(side == "" || kind == "")
         continue;

      string symbol = OrderGetString(ORDER_SYMBOL);
      double stop_loss = OrderGetDouble(ORDER_SL);
      double take_profit = OrderGetDouble(ORDER_TP);
      string stop_json =
         stop_loss > 0 ? "\"" + DecimalText(stop_loss) + "\"" : "null";
      string target_json =
         take_profit > 0 ? "\"" + DecimalText(take_profit) + "\"" : "null";
      string snapshot = StringFormat(
         "{\"brokerOrderId\":\"%I64u\",\"canonicalSymbol\":\"%s\","
         "\"venueSymbol\":\"%s\",\"side\":\"%s\",\"kind\":\"%s\","
         "\"quantity\":\"%s\",\"price\":\"%s\",\"stopLoss\":%s,"
         "\"takeProfit\":%s,\"magic\":%I64d,\"comment\":\"%s\","
         "\"createdAtMs\":%I64u,\"observedAtMs\":%I64u}",
         ticket, JsonEscape(symbol), JsonEscape(symbol), side, kind,
         DecimalText(OrderGetDouble(ORDER_VOLUME_CURRENT)),
         DecimalText(OrderGetDouble(ORDER_PRICE_OPEN)),
         stop_json, target_json, OrderGetInteger(ORDER_MAGIC),
         JsonEscape(OrderGetString(ORDER_COMMENT)),
         NormalizeBrokerTimestampMs(
            (ulong)OrderGetInteger(ORDER_TIME_SETUP_MSC)),
         observed_at);
      if(appended > 0)
         output += ",";
      output += snapshot;
      appended++;
   }
   output += "]";
   return output;
}

string InstrumentSnapshotsJson()
{
   int total = SymbolsTotal(true);
   if(total <= 0)
      return "[]";
   int take = MathMin(total, MAX_INSTRUMENTS_PER_HEARTBEAT);
   string output = "[";
   int appended = 0;
   for(int offset = 0; offset < take; offset++)
   {
      int index = (g_instrument_cursor + offset) % total;
      string symbol = SymbolName(index, true);
      double quantity_step = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
      double min_quantity = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
      double max_quantity = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX);
      double price_tick = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_SIZE);
      if(price_tick <= 0)
         price_tick = SymbolInfoDouble(symbol, SYMBOL_POINT);
      if(symbol == "" || quantity_step <= 0 || min_quantity <= 0 ||
         max_quantity < min_quantity || price_tick <= 0)
         continue;

      MqlTick tick = {};
      bool has_tick = SymbolInfoTick(symbol, tick);
      double tick_value = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_VALUE_LOSS);
      if(tick_value <= 0)
         tick_value = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_VALUE);
      double min_stop_distance =
         (double)SymbolInfoInteger(symbol, SYMBOL_TRADE_STOPS_LEVEL) *
         SymbolInfoDouble(symbol, SYMBOL_POINT);
      bool trade_allowed =
         (ENUM_SYMBOL_TRADE_MODE)SymbolInfoInteger(symbol, SYMBOL_TRADE_MODE) !=
         SYMBOL_TRADE_MODE_DISABLED;
      string tick_value_json =
         tick_value > 0 ? "\"" + DecimalText(tick_value) + "\"" : "null";
      string stop_distance_json =
         min_stop_distance > 0
         ? "\"" + DecimalText(min_stop_distance) + "\""
         : "null";
      string bid_json =
         has_tick && tick.bid >= 0 ? "\"" + DecimalText(tick.bid) + "\"" : "null";
      string ask_json =
         has_tick && tick.ask >= tick.bid
         ? "\"" + DecimalText(tick.ask) + "\""
         : "null";
      string snapshot = StringFormat(
         "{\"spec\":{\"canonicalSymbol\":\"%s\",\"venueSymbol\":\"%s\","
         "\"quantityUnit\":\"lots\",\"quantityStep\":\"%s\","
         "\"minQuantity\":\"%s\",\"maxQuantity\":\"%s\","
         "\"priceTick\":\"%s\",\"tickValuePerQuantity\":%s,"
         "\"minStopDistance\":%s,\"tradeAllowed\":%s},"
         "\"bid\":%s,\"ask\":%s,\"observedAtMs\":%I64u}",
         JsonEscape(symbol), JsonEscape(symbol),
         DecimalText(quantity_step), DecimalText(min_quantity),
         DecimalText(max_quantity), DecimalText(price_tick),
         tick_value_json, stop_distance_json,
         trade_allowed ? "true" : "false",
         bid_json, ask_json, EpochMilliseconds());
      if(appended > 0)
         output += ",";
      output += snapshot;
      appended++;
   }
   output += "]";
   g_instrument_cursor = (g_instrument_cursor + take) % total;
   return output;
}

string DecimalText(const double value)
{
   string text = DoubleToString(value, 12);
   while(StringFind(text, ".") >= 0 &&
         StringSubstr(text, StringLen(text) - 1, 1) == "0")
      text = StringSubstr(text, 0, StringLen(text) - 1);
   if(StringSubstr(text, StringLen(text) - 1, 1) == ".")
      text = StringSubstr(text, 0, StringLen(text) - 1);
   return text == "-0" ? "0" : text;
}

string AccountSnapshotJson()
{
   ENUM_ACCOUNT_TRADE_MODE trade_mode =
      (ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE);
   string mode = "unknown";
   if(trade_mode == ACCOUNT_TRADE_MODE_REAL)
      mode = "live";
   else if(trade_mode == ACCOUNT_TRADE_MODE_DEMO ||
           trade_mode == ACCOUNT_TRADE_MODE_CONTEST)
      mode = "demo";

   return StringFormat(
      "{\"login\":\"%I64d\",\"broker\":\"%s\",\"server\":\"%s\","
      "\"mode\":\"%s\",\"currency\":\"%s\","
      "\"balance\":\"%.8f\",\"equity\":\"%.8f\",\"margin\":\"%.8f\","
      "\"freeMargin\":\"%.8f\",\"leverage\":%d,\"tradeAllowed\":%s,"
      "\"terminalBuild\":%d,\"eaVersion\":\"%s\"}",
      AccountInfoInteger(ACCOUNT_LOGIN),
      JsonEscape(AccountInfoString(ACCOUNT_COMPANY)),
      JsonEscape(AccountInfoString(ACCOUNT_SERVER)),
      mode,
      JsonEscape(AccountInfoString(ACCOUNT_CURRENCY)),
      AccountInfoDouble(ACCOUNT_BALANCE),
      AccountInfoDouble(ACCOUNT_EQUITY),
      AccountInfoDouble(ACCOUNT_MARGIN),
      AccountInfoDouble(ACCOUNT_MARGIN_FREE),
      (int)AccountInfoInteger(ACCOUNT_LEVERAGE),
      AccountInfoInteger(ACCOUNT_TRADE_ALLOWED) ? "true" : "false",
      (int)TerminalInfoInteger(TERMINAL_BUILD),
      EA_VERSION
   );
}

int HttpJson(const string method, const string path, const string body,
             const string bearer_token, string &response)
{
   string url = GatewayUrl;
   while(StringLen(url) > 0 && StringSubstr(url, StringLen(url) - 1, 1) == "/")
      url = StringSubstr(url, 0, StringLen(url) - 1);
   string headers = "Content-Type: application/json\r\n"
                    "Accept: application/json\r\n";
   if(bearer_token != "")
      headers += "Authorization: Bearer " + bearer_token + "\r\n";

   char request_data[];
   char response_data[];
   string response_headers;
   if(body == "")
      ArrayResize(request_data, 0);
   else
   {
      StringToCharArray(body, request_data, 0, WHOLE_ARRAY, CP_UTF8);
      if(ArraySize(request_data) > 0)
         ArrayResize(request_data, ArraySize(request_data) - 1);
   }

   ResetLastError();
   int status = WebRequest(method, url + path, headers,
                           MathMax(1000, HttpTimeoutMs), request_data,
                           response_data, response_headers);
   response = CharArrayToString(response_data, 0, -1, CP_UTF8);
   if(status == -1)
      PrintFormat("SMCExecutionEA: WebRequest failed, error=%d. Check the allowed URL list.",
                  GetLastError());
   return status;
}

void BufferEvent(const string event_json)
{
   int size = ArraySize(g_events);
   for(int index = 0; index < size; index++)
   {
      if(g_events[index] == event_json)
         return;
   }
   if(size >= MAX_BUFFERED_EVENTS)
   {
      // Preserve bounded memory. Command outcomes can be reconstructed from
      // the local journal; transaction telemetry loss remains visible in logs.
      for(int index = 1; index < size; index++)
         g_events[index - 1] = g_events[index];
      ArrayResize(g_events, size - 1);
      size--;
      Print("SMCExecutionEA: event buffer full; oldest event dropped.");
   }
   ArrayResize(g_events, size + 1);
   g_events[size] = event_json;
}

void BufferRejected(const string command_id, const ulong retcode,
                    const string message)
{
   if(BufferedCommandEvent(command_id))
      return;
   BufferEvent(StringFormat(
      "{\"type\":\"commandRejected\",\"commandId\":\"%s\","
      "\"retcode\":%I64u,\"message\":\"%s\",\"occurredAtMs\":%I64u}",
      JsonEscape(command_id), retcode, JsonEscape(message), EpochMilliseconds()));
}

void BufferAccepted(const string command_id, const ulong order_id,
                    const ulong deal_id, const ulong retcode,
                    const string message, const ulong occurred_at_ms)
{
   if(BufferedCommandEvent(command_id))
      return;
   BufferEvent(StringFormat(
      "{\"type\":\"commandAccepted\",\"commandId\":\"%s\","
      "\"brokerOrderId\":%s,\"brokerDealId\":%s,"
      "\"retcode\":%I64u,\"message\":\"%s\",\"occurredAtMs\":%I64u}",
      JsonEscape(command_id),
      JsonNullableUlong(order_id),
      JsonNullableUlong(deal_id),
      retcode,
      JsonEscape(message),
      occurred_at_ms
   ));
}

void BufferUnknown(const string command_id, const string message)
{
   if(BufferedCommandEvent(command_id))
      return;
   BufferEvent(StringFormat(
      "{\"type\":\"commandUnknown\",\"commandId\":\"%s\","
      "\"message\":\"%s\",\"occurredAtMs\":%I64u}",
      JsonEscape(command_id), JsonEscape(message), EpochMilliseconds()));
}

bool BufferedCommandEvent(const string command_id)
{
   string marker = "\"commandId\":\"" + JsonEscape(command_id) + "\"";
   for(int index = 0; index < ArraySize(g_events); index++)
      if(StringFind(g_events[index], marker) >= 0)
         return true;
   return false;
}

bool CommandWasSeen(const string command_id)
{
   return FindCommandRecord(command_id) >= 0;
}

int FindCommandRecord(const string command_id)
{
   if(command_id == "")
      return -1;
   for(int index = ArraySize(g_command_ids) - 1; index >= 0; index--)
      if(g_command_ids[index] == command_id)
         return index;
   return -1;
}

string CommandJournalFile()
{
   return StringFormat("SMCExecutionEA-%I64d.journal.tsv",
                       AccountInfoInteger(ACCOUNT_LOGIN));
}

void ResizeJournal(const int size)
{
   ArrayResize(g_command_ids, size);
   ArrayResize(g_command_states, size);
   ArrayResize(g_command_orders, size);
   ArrayResize(g_command_deals, size);
   ArrayResize(g_command_retcodes, size);
   ArrayResize(g_command_times, size);
   ArrayResize(g_command_messages, size);
}

void UpsertCommandRecord(const string command_id, const string state,
                         const string order_id, const string deal_id,
                         const ulong retcode, const ulong occurred_at_ms,
                         const string message)
{
   int index = FindCommandRecord(command_id);
   if(index < 0)
   {
      int size = ArraySize(g_command_ids);
      if(size >= MAX_JOURNAL_COMMANDS)
      {
         for(int current = 1; current < size; current++)
         {
            g_command_ids[current - 1] = g_command_ids[current];
            g_command_states[current - 1] = g_command_states[current];
            g_command_orders[current - 1] = g_command_orders[current];
            g_command_deals[current - 1] = g_command_deals[current];
            g_command_retcodes[current - 1] = g_command_retcodes[current];
            g_command_times[current - 1] = g_command_times[current];
            g_command_messages[current - 1] = g_command_messages[current];
         }
         index = size - 1;
      }
      else
      {
         index = size;
         ResizeJournal(size + 1);
      }
   }
   g_command_ids[index] = command_id;
   g_command_states[index] = state;
   g_command_orders[index] = order_id;
   g_command_deals[index] = deal_id;
   g_command_retcodes[index] = retcode;
   g_command_times[index] = occurred_at_ms;
   g_command_messages[index] = message;
}

void LoadCommandJournal()
{
   ResizeJournal(0);
   int handle = FileOpen(CommandJournalFile(),
                         FILE_READ|FILE_CSV|FILE_ANSI|FILE_SHARE_READ,
                         '\t', CP_UTF8);
   if(handle == INVALID_HANDLE)
      return;
   while(!FileIsEnding(handle))
   {
      string command_id = FileReadString(handle);
      string state = FileReadString(handle);
      string order_id = FileReadString(handle);
      string deal_id = FileReadString(handle);
      string retcode_text = FileReadString(handle);
      string occurred_text = FileReadString(handle);
      string message = FileReadString(handle);
      if(command_id == "" || state == "")
         continue;
      UpsertCommandRecord(command_id, state, order_id, deal_id,
                          (ulong)StringToInteger(retcode_text),
                          (ulong)StringToInteger(occurred_text), message);
   }
   FileClose(handle);
}

bool RecordCommandState(const string command_id, const string state,
                        const ulong order_id, const ulong deal_id,
                        const ulong retcode, const string message)
{
   ulong occurred_at_ms = EpochMilliseconds();
   int handle = FileOpen(CommandJournalFile(),
                         FILE_READ|FILE_WRITE|FILE_CSV|FILE_ANSI|FILE_SHARE_READ,
                         '\t', CP_UTF8);
   if(handle == INVALID_HANDLE)
   {
      PrintFormat("SMCExecutionEA: cannot persist command journal, error=%d",
                  GetLastError());
      return false;
   }
   FileSeek(handle, 0, SEEK_END);
   FileWrite(handle, command_id, state,
             order_id == 0 ? "" : IntegerToString((long)order_id),
             deal_id == 0 ? "" : IntegerToString((long)deal_id),
             IntegerToString((long)retcode),
             IntegerToString((long)occurred_at_ms), message);
   FileFlush(handle);
   FileClose(handle);
   UpsertCommandRecord(command_id, state,
                       order_id == 0 ? "" : IntegerToString((long)order_id),
                       deal_id == 0 ? "" : IntegerToString((long)deal_id),
                       retcode, occurred_at_ms, message);
   return true;
}

void ReplayRecordedOutcome(const string command_id)
{
   int index = FindCommandRecord(command_id);
   if(index < 0 || BufferedCommandEvent(command_id))
      return;
   if(g_command_states[index] == "accepted")
   {
      BufferAccepted(command_id,
                     (ulong)StringToInteger(g_command_orders[index]),
                     (ulong)StringToInteger(g_command_deals[index]),
                     g_command_retcodes[index],
                     g_command_messages[index],
                     g_command_times[index]);
      return;
   }
   if(g_command_states[index] == "rejected")
   {
      BufferRejected(command_id, g_command_retcodes[index],
                     g_command_messages[index]);
      return;
   }
   if(g_command_states[index] == "submitting")
   {
      ulong order_id = 0;
      ulong deal_id = 0;
      string message = "";
      if(FindBrokerOutcome(command_id, order_id, deal_id, message))
      {
         RecordCommandState(command_id, "accepted", order_id, deal_id,
                            TRADE_RETCODE_DONE, message);
         int reconciled = FindCommandRecord(command_id);
         BufferAccepted(command_id, order_id, deal_id, TRADE_RETCODE_DONE,
                        message, g_command_times[reconciled]);
      }
      else
      {
         BufferUnknown(
            command_id,
            "Broker submission outcome is ambiguous; command was not resubmitted");
      }
   }
}

string CommandComment(const string command_id)
{
   return StringSubstr("SMC:" + command_id, 0, 31);
}

bool FindBrokerOutcome(const string command_id, ulong &order_id,
                       ulong &deal_id, string &message)
{
   string expected = CommandComment(command_id);
   for(int index = OrdersTotal() - 1; index >= 0; index--)
   {
      ulong ticket = OrderGetTicket(index);
      if(ticket > 0 && OrderGetString(ORDER_COMMENT) == expected)
      {
         order_id = ticket;
         message = "Reconciled from active MT5 order";
         return true;
      }
   }
   for(int index = PositionsTotal() - 1; index >= 0; index--)
   {
      ulong ticket = PositionGetTicket(index);
      if(ticket > 0 && PositionGetString(POSITION_COMMENT) == expected)
      {
         order_id = ticket;
         message = "Reconciled from active MT5 position";
         return true;
      }
   }

   datetime now = TimeCurrent();
   if(!HistorySelect(now - 7 * 24 * 60 * 60, now))
      return false;
   for(int index = HistoryOrdersTotal() - 1; index >= 0; index--)
   {
      ulong ticket = HistoryOrderGetTicket(index);
      if(ticket > 0 && HistoryOrderGetString(ticket, ORDER_COMMENT) == expected)
      {
         order_id = ticket;
         message = "Reconciled from MT5 order history";
         return true;
      }
   }
   for(int index = HistoryDealsTotal() - 1; index >= 0; index--)
   {
      ulong ticket = HistoryDealGetTicket(index);
      if(ticket > 0 && HistoryDealGetString(ticket, DEAL_COMMENT) == expected)
      {
         deal_id = ticket;
         order_id = (ulong)HistoryDealGetInteger(ticket, DEAL_ORDER);
         message = "Reconciled from MT5 deal history";
         return true;
      }
   }
   return false;
}

void ResetSession(const string reason)
{
   PrintFormat("SMCExecutionEA: %s; pairing again.", reason);
   g_session_token = "";
   g_account_id = "";
   g_gateway_time_at_sync_ms = 0;
   g_gateway_time_sync_tick_ms = 0;
   g_portfolio_failure_count = 0;
   g_event_failure_count = 0;
   g_instrument_failure_count = 0;
   g_next_portfolio_retry_at = 0;
   g_next_event_retry_at = 0;
   g_next_instrument_retry_at = 0;
   g_last_snapshot_at = 0;
   g_last_instrument_snapshot_at = 0;
   FileDelete(SessionCacheFile(), 0);
}

string SessionCacheFile()
{
   return StringFormat("SMCExecutionEA-%I64d.session.tsv",
                       AccountInfoInteger(ACCOUNT_LOGIN));
}

bool SaveSessionCache()
{
   int handle = FileOpen(SessionCacheFile(),
                         FILE_WRITE|FILE_CSV|FILE_ANSI,
                         '\t', CP_UTF8);
   if(handle == INVALID_HANDLE)
   {
      PrintFormat("SMCExecutionEA: cannot persist session cache, error=%d",
                  GetLastError());
      return false;
   }
   FileWrite(handle,
             IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)),
             AccountInfoString(ACCOUNT_SERVER),
             GatewayUrl,
             g_account_id,
             g_session_token);
   FileFlush(handle);
   FileClose(handle);
   return true;
}

void LoadSessionCache()
{
   int handle = FileOpen(SessionCacheFile(),
                         FILE_READ|FILE_CSV|FILE_ANSI|FILE_SHARE_READ,
                         '\t', CP_UTF8);
   if(handle == INVALID_HANDLE)
      return;
   string login = FileReadString(handle);
   string server = FileReadString(handle);
   string gateway = FileReadString(handle);
   string account_id = FileReadString(handle);
   string session_token = FileReadString(handle);
   FileClose(handle);
   if(login != IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) ||
      server != AccountInfoString(ACCOUNT_SERVER) ||
      gateway != GatewayUrl ||
      account_id == "" || session_token == "")
   {
      FileDelete(SessionCacheFile(), 0);
      return;
   }
   g_account_id = account_id;
   g_session_token = session_token;
   PrintFormat("SMCExecutionEA: restored paired session for account %s.",
               g_account_id);
}

ENUM_ORDER_TYPE_FILLING ResolveFillingMode(const string symbol)
{
   int modes = (int)SymbolInfoInteger(symbol, SYMBOL_FILLING_MODE);
   if((modes & SYMBOL_FILLING_FOK) == SYMBOL_FILLING_FOK)
      return ORDER_FILLING_FOK;
   if((modes & SYMBOL_FILLING_IOC) == SYMBOL_FILLING_IOC)
      return ORDER_FILLING_IOC;
   return ORDER_FILLING_RETURN;
}

bool NextCommandObject(const string json, int &cursor, string &object)
{
   if(cursor <= 0)
   {
      int commands_at = StringFind(json, "\"commands\"");
      if(commands_at < 0)
         return false;
      cursor = StringFind(json, "[", commands_at);
      if(cursor < 0)
         return false;
      cursor++;
   }

   while(cursor < StringLen(json))
   {
      string current = StringSubstr(json, cursor, 1);
      if(current == "]")
         return false;
      if(current == "{")
         break;
      cursor++;
   }
   if(cursor >= StringLen(json))
      return false;

   int start = cursor;
   int depth = 0;
   bool quoted = false;
   bool escaped = false;
   for(int index = start; index < StringLen(json); index++)
   {
      ushort character = StringGetCharacter(json, index);
      if(quoted)
      {
         if(escaped)
            escaped = false;
         else if(character == '\\')
            escaped = true;
         else if(character == '"')
            quoted = false;
         continue;
      }
      if(character == '"')
         quoted = true;
      else if(character == '{')
         depth++;
      else if(character == '}')
      {
         depth--;
         if(depth == 0)
         {
            object = StringSubstr(json, start, index - start + 1);
            cursor = index + 1;
            return true;
         }
      }
   }
   return false;
}

bool JsonString(const string json, const string key, string &value)
{
   int key_at = StringFind(json, "\"" + key + "\"");
   if(key_at < 0)
      return false;
   int colon = StringFind(json, ":", key_at + StringLen(key) + 2);
   if(colon < 0)
      return false;
   int start = colon + 1;
   while(start < StringLen(json) && StringFind(" \r\n\t", StringSubstr(json, start, 1)) >= 0)
      start++;
   if(StringSubstr(json, start, 4) == "null" || StringSubstr(json, start, 1) != "\"")
      return false;
   start++;

   value = "";
   bool escaped = false;
   for(int index = start; index < StringLen(json); index++)
   {
      string character = StringSubstr(json, index, 1);
      if(escaped)
      {
         if(character == "n")
            value += "\n";
         else if(character == "r")
            value += "\r";
         else if(character == "t")
            value += "\t";
         else
            value += character;
         escaped = false;
      }
      else if(character == "\\")
         escaped = true;
      else if(character == "\"")
         return true;
      else
         value += character;
   }
   return false;
}

bool JsonNumber(const string json, const string key, string &value)
{
   int key_at = StringFind(json, "\"" + key + "\"");
   if(key_at < 0)
      return false;
   int colon = StringFind(json, ":", key_at + StringLen(key) + 2);
   if(colon < 0)
      return false;
   int start = colon + 1;
   while(start < StringLen(json) && StringFind(" \r\n\t", StringSubstr(json, start, 1)) >= 0)
      start++;
   int end = start;
   while(end < StringLen(json) &&
         StringFind("0123456789.-", StringSubstr(json, end, 1)) >= 0)
      end++;
   if(end == start)
      return false;
   value = StringSubstr(json, start, end - start);
   return true;
}

string JsonEscape(string value)
{
   StringReplace(value, "\\", "\\\\");
   StringReplace(value, "\"", "\\\"");
   StringReplace(value, "\r", "\\r");
   StringReplace(value, "\n", "\\n");
   StringReplace(value, "\t", "\\t");
   return value;
}

string JsonNullableUlong(const ulong value)
{
   return value == 0 ? "null" : "\"" + IntegerToString((long)value) + "\"";
}

ulong EpochMilliseconds()
{
   if(g_gateway_time_at_sync_ms > 0)
      return g_gateway_time_at_sync_ms +
             (GetTickCount64() - g_gateway_time_sync_tick_ms);

   datetime now = TimeGMT();
   if(now <= 0)
      now = TimeLocal() + TimeGMTOffset();
   return (ulong)now * 1000;
}

ulong NormalizeBrokerTimestampMs(const ulong broker_time_ms)
{
   if(broker_time_ms == 0)
      return 0;
   datetime broker_now = TimeTradeServer();
   if(broker_now <= 0)
      return broker_time_ms;
   long corrected = (long)broker_time_ms +
                    ((long)EpochMilliseconds() - (long)broker_now * 1000);
   return corrected > 0 ? (ulong)corrected : broker_time_ms;
}

void SyncGatewayClockFromJson(const string response)
{
   string server_time;
   if(!JsonNumber(response, "serverTimeMs", server_time))
      return;
   long parsed = StringToInteger(server_time);
   if(parsed <= 0)
      return;
   g_gateway_time_at_sync_ms = (ulong)parsed;
   g_gateway_time_sync_tick_ms = GetTickCount64();
}

void LogHttpFailure(const string operation, const int status,
                    const string response)
{
   string safe = response;
   StringReplace(safe, "\r", " ");
   StringReplace(safe, "\n", " ");
   StringReplace(safe, "\t", " ");
   if(StringLen(safe) > 512)
      safe = StringSubstr(safe, 0, 512) + "...";
   if(safe == "")
      PrintFormat("SMCExecutionEA: %s failed, HTTP=%d", operation, status);
   else
      PrintFormat("SMCExecutionEA: %s failed, HTTP=%d, response=%s",
                  operation, status, safe);
}

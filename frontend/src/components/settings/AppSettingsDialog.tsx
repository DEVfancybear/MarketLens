"use client";

import { useEffect, useState } from "react";
import { useAtom } from "jotai";
import { CheckCircle2, Loader2, X } from "lucide-react";
import { backendSessionAtom } from "@/store/authStore";
import { useAtomValue } from "jotai";
import { integrationSettingsOpenAtom } from "@/store/integrationSettingsStore";
import { getIntegrationSettings, saveIntegrationSettings, testIntegration, type IntegrationSettingsWrite } from "@/services/api/resources/integrationsApi";

const empty: IntegrationSettingsWrite = {
  mt5: { login: "", server: "", password: "", clearPassword: false },
  telegram: { chatId: "", botToken: "", enabled: false, clearBotToken: false },
  discord: { webhookUrl: "", enabled: false, clearWebhook: false },
};

export function AppSettingsDialog() {
  const [open, setOpen] = useAtom(integrationSettingsOpenAtom);
  const backendSession = useAtomValue(backendSessionAtom);
  const [draft, setDraft] = useState<IntegrationSettingsWrite>(empty);
  const [configured, setConfigured] = useState({ mt5: false, telegram: false, discord: false });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!open || !backendSession) return;
    setBusy(true); setMessage("");
    getIntegrationSettings().then((v) => {
      setDraft({
        mt5: { login: v.mt5.login, server: v.mt5.server, password: "", clearPassword: false },
        telegram: { chatId: v.telegram.chatId, botToken: "", enabled: v.telegram.enabled, clearBotToken: false },
        discord: { webhookUrl: "", enabled: v.discord.enabled, clearWebhook: false },
      });
      setConfigured({ mt5: v.mt5.passwordConfigured, telegram: v.telegram.botTokenConfigured, discord: v.discord.webhookConfigured });
    }).catch(() => setMessage("Unable to load integration settings.")).finally(() => setBusy(false));
  }, [backendSession, open]);

  if (!open) return null;
  const field = "h-9 w-full rounded border border-terminal-border bg-terminal-bg px-3 text-sm text-ink outline-none focus:border-brand";
  const save = async () => { setBusy(true); setMessage(""); try { const v=await saveIntegrationSettings(draft); setConfigured({mt5:v.mt5.passwordConfigured,telegram:v.telegram.botTokenConfigured,discord:v.discord.webhookConfigured}); setDraft((d)=>({...d,mt5:{...d.mt5,password:"",clearPassword:false},telegram:{...d.telegram,botToken:"",clearBotToken:false},discord:{...d.discord,webhookUrl:"",clearWebhook:false}})); setMessage("Settings saved."); } catch { setMessage("Save failed. Check the fields and backend session."); } finally { setBusy(false); } };
  const test = async (channel:"telegram"|"discord") => { setBusy(true); setMessage(""); try { await testIntegration(channel); setMessage(`${channel} test sent.`); } catch { setMessage(`${channel} test failed.`); } finally { setBusy(false); } };

  return <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60" onMouseDown={()=>setOpen(false)}>
    <div className="max-h-[90vh] w-[min(720px,calc(100vw-32px))] overflow-y-auto rounded-lg border border-terminal-border bg-terminal-panel shadow-2xl" onMouseDown={(e)=>e.stopPropagation()}>
      <div className="flex h-14 items-center justify-between border-b border-terminal-border px-5"><div><h2 className="text-base font-semibold text-ink">Connections & notifications</h2><p className="text-xs text-ink-faint">Secrets are encrypted by the backend and never returned.</p></div><button onClick={()=>setOpen(false)} className="rounded p-2 text-ink-muted hover:bg-terminal-hover"><X size={18}/></button></div>
      {!backendSession ? <div className="p-8 text-sm text-ink-muted">Sign in and establish a backend session to manage private integrations.</div> : <div className="space-y-6 p-5">
        <Section title="MetaTrader 5" note="Saved credentials are used for runtime provisioning. Restart or reconnect the local MT5 bridge after changing the active account.">
          <div className="grid gap-3 sm:grid-cols-2"><Input label="Login" value={draft.mt5.login} onChange={(v)=>setDraft({...draft,mt5:{...draft.mt5,login:v}})} cls={field}/><Input label="Broker server" value={draft.mt5.server} onChange={(v)=>setDraft({...draft,mt5:{...draft.mt5,server:v}})} cls={field}/></div>
          <Secret label="Password" configured={configured.mt5} value={draft.mt5.password} onChange={(v)=>setDraft({...draft,mt5:{...draft.mt5,password:v,clearPassword:false}})} onClear={()=>setDraft({...draft,mt5:{...draft.mt5,password:"",clearPassword:true}})} cls={field}/>
        </Section>
        <Section title="Telegram" note="Bot token + target chat ID for alert delivery.">
          <Input label="Chat ID" value={draft.telegram.chatId} onChange={(v)=>setDraft({...draft,telegram:{...draft.telegram,chatId:v}})} cls={field}/><Secret label="Bot token" configured={configured.telegram} value={draft.telegram.botToken} onChange={(v)=>setDraft({...draft,telegram:{...draft.telegram,botToken:v,clearBotToken:false}})} onClear={()=>setDraft({...draft,telegram:{...draft.telegram,botToken:"",clearBotToken:true}})} cls={field}/><Toggle label="Enable Telegram alerts" checked={draft.telegram.enabled} onChange={(v)=>setDraft({...draft,telegram:{...draft.telegram,enabled:v}})}/><button disabled={busy||!configured.telegram} onClick={()=>void test("telegram")} className="rounded border border-terminal-border px-3 py-1.5 text-xs text-ink disabled:opacity-40">Send test</button>
        </Section>
        <Section title="Discord" note="Incoming webhook URL for alert delivery.">
          <Secret label="Webhook URL" configured={configured.discord} value={draft.discord.webhookUrl} onChange={(v)=>setDraft({...draft,discord:{...draft.discord,webhookUrl:v,clearWebhook:false}})} onClear={()=>setDraft({...draft,discord:{...draft.discord,webhookUrl:"",clearWebhook:true}})} cls={field}/><Toggle label="Enable Discord alerts" checked={draft.discord.enabled} onChange={(v)=>setDraft({...draft,discord:{...draft.discord,enabled:v}})}/><button disabled={busy||!configured.discord} onClick={()=>void test("discord")} className="rounded border border-terminal-border px-3 py-1.5 text-xs text-ink disabled:opacity-40">Send test</button>
        </Section>
      </div>}
      <div className="flex items-center justify-between border-t border-terminal-border px-5 py-3"><span className="flex items-center gap-1.5 text-xs text-ink-muted">{message&&<CheckCircle2 size={14}/>} {message}</span><button disabled={busy||!backendSession} onClick={()=>void save()} className="flex items-center gap-2 rounded bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy&&<Loader2 size={14} className="animate-spin"/>}Save</button></div>
    </div></div>;
}
function Section({title,note,children}:{title:string;note:string;children:React.ReactNode}) { return <section className="space-y-3 rounded border border-terminal-border p-4"><div><h3 className="text-sm font-semibold text-ink">{title}</h3><p className="mt-1 text-xs text-ink-faint">{note}</p></div>{children}</section>; }
function Input({label,value,onChange,cls}:{label:string;value:string;onChange:(v:string)=>void;cls:string}) { return <label className="block text-xs text-ink-muted"><span className="mb-1 block">{label}</span><input className={cls} value={value} onChange={(e)=>onChange(e.target.value)}/></label>; }
function Secret({label,configured,value,onChange,onClear,cls}:{label:string;configured:boolean;value:string;onChange:(v:string)=>void;onClear:()=>void;cls:string}) { return <div><label className="block text-xs text-ink-muted"><span className="mb-1 block">{label}</span><input type="password" autoComplete="new-password" className={cls} value={value} placeholder={configured?"Configured — enter to replace":"Not configured"} onChange={(e)=>onChange(e.target.value)}/></label>{configured&&<button type="button" onClick={onClear} className="mt-1 text-[11px] text-bear hover:underline">Clear saved secret</button>}</div>; }
function Toggle({label,checked,onChange}:{label:string;checked:boolean;onChange:(v:boolean)=>void}) { return <label className="flex items-center gap-2 text-xs text-ink"><input type="checkbox" checked={checked} onChange={(e)=>onChange(e.target.checked)}/>{label}</label>; }

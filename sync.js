/* Optional Supabase cloud sync; local entries remain usable without a connection. */
const CONFIG_KEY='milestones_cloud_config_v1', SESSION_KEY='milestones_cloud_session_v1';
const getJSON = key => {try{return JSON.parse(localStorage.getItem(key)||'null')}catch{return null}};
export class CloudSync {
  constructor() {this.config=getJSON(CONFIG_KEY)||null; this.session=getJSON(SESSION_KEY)||null; this.busy=false;}
  setConfig(url,key) {
    url=(url||'').trim().replace(/\/+$/,''); key=(key||'').trim();
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) throw new Error('Use the HTTPS Project URL ending in .supabase.co.');
    if (!key || key.length<20) throw new Error('Paste your Supabase publishable/anon key. Never use a service-role or secret key.');
    const wasDifferent=this.config?.url!==url || this.config?.key!==key;
    this.config={url,key}; localStorage.setItem(CONFIG_KEY,JSON.stringify(this.config));
    if(wasDifferent)this.signOut();
  }
  signOut() {this.session=null; localStorage.removeItem(SESSION_KEY);}
  get ready() {return !!(this.config?.url && this.config?.key && this.session?.refresh_token);}
  get email() {return this.session?.user?.email||'';}
  async request(path,opts={}) {
    if(!this.config)throw new Error('Set up your Supabase project first.');
    const headers={'apikey':this.config.key,'Content-Type':'application/json',...(opts.headers||{})};
    const r=await fetch(this.config.url+path,{...opts,headers});
    let body=null;try{body=await r.json()}catch{}
    if(!r.ok)throw new Error(body?.msg||body?.message||body?.error_description||body?.error||`Cloud request failed (${r.status}).`);
    return body;
  }
  saveSession(s) {
    this.session={...s,expires_at:s.expires_at||Math.floor(Date.now()/1000)+(s.expires_in||3600)};
    localStorage.setItem(SESSION_KEY,JSON.stringify(this.session));
  }
  async signIn(email,password) {
    const s=await this.request('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email,password})});
    if(!s?.access_token)throw new Error('No session returned. Check your email confirmation.');
    this.saveSession(s);return s;
  }
  async signUp(email,password) {
    const s=await this.request('/auth/v1/signup',{method:'POST',body:JSON.stringify({email,password})});
    if(s?.access_token)this.saveSession(s);
    return s;
  }
  async accessToken() {
    if(!this.session?.refresh_token)throw new Error('Sign in to enable cloud sync.');
    if(this.session.access_token && this.session.expires_at>Date.now()/1000+60)return this.session.access_token;
    const s=await this.request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:JSON.stringify({refresh_token:this.session.refresh_token})});
    this.saveSession(s);return s.access_token;
  }
  async sync(localEvents,mergeFn) {
    if(!this.ready)throw new Error('Configure cloud sync and sign in first.');
    if(this.busy)return null;
    this.busy=true;
    try {
      const token=await this.accessToken(), uid=this.session.user.id;
      const headers={Authorization:`Bearer ${token}`};
      const remote=[]; let offset=0;const pageSize=500;
      for(;;) {
        const path=`/rest/v1/milestone_entries?select=id,data,updated_at&order=id.asc&limit=${pageSize}&offset=${offset}`;
        const page=await this.request(path,{headers});
        if(!Array.isArray(page))throw new Error('Cloud table is missing. Run the setup SQL first.');
        remote.push(...page);if(page.length<pageSize)break;offset+=pageSize;
      }
      const remoteByID=new Map(remote.map(row=>[row.id,row]));
      const localByID=new Map(localEvents.map(e=>[e.id,e]));
      const merged=[];
      for(const [id,e] of localByID) {
        const cloud=remoteByID.get(id);
        merged.push(cloud && Number(cloud.updated_at)>Number(e.updatedAt||0)?cloud.data:e);
      }
      for(const row of remote)if(!localByID.has(row.id))merged.push(row.data);
      /* Make merged entries durable BEFORE attempting uploads (safe offline fallback). */
      mergeFn(merged);
      const uploads=merged.filter(e=>!remoteByID.has(e.id)||Number(e.updatedAt||0)>Number(remoteByID.get(e.id).updated_at));
      for(let i=0;i<uploads.length;i+=100) {
        const records=uploads.slice(i,i+100).map(e=>({id:e.id,user_id:uid,data:e,updated_at:e.updatedAt||0}));
        await this.request('/rest/v1/milestone_entries?on_conflict=user_id,id',{
          method:'POST',headers:{...headers,Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify(records)
        });
      }
      return {downloaded:remote.length,uploaded:uploads.length};
    } finally {this.busy=false;}
  }
}

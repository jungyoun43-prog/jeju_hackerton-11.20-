import {createServer} from 'node:http';

/** Callback/media listener only. There is deliberately no HTTP route that can initiate a call. */
export async function createPhoneOperatorServer({adapter,publicOrigin,WebSocketServerImpl}={}) {
  const origin=new URL(publicOrigin);
  if(origin.protocol!=='https:'||origin.origin!==publicOrigin)throw new Error('Invalid operator origin');
  const WebSocketServer=WebSocketServerImpl || (await import('ws')).WebSocketServer;
  const wss=new WebSocketServer({noServer:true,maxPayload:65536});
  const server=createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    if(req.method!=='POST'||!/^\/phone\/status\/[A-Za-z0-9_-]{32,100}$/.test(req.url||'')
      || req.headers['content-type']?.split(';')[0]!=='application/x-www-form-urlencoded') {
      res.writeHead(404);res.end();return;
    }
    let body='',size=0;
    try {
      for await(const chunk of req){size+=chunk.length;if(size>32768){res.writeHead(413);res.end();return;}body+=chunk.toString('utf8');}
      await adapter.handleStatusCallback({url:`${publicOrigin}${req.url}`,headers:req.headers,body});
      res.writeHead(204);res.end();
    }catch{res.writeHead(403);res.end();}
  });
  server.on('upgrade',(req,socket,head)=>{
    if(req.url!=='/phone/media'){socket.destroy();return;}
    wss.handleUpgrade(req,socket,head,ws=>adapter.acceptMediaSocket({socket:ws,url:`${publicOrigin}/phone/media`,headers:req.headers}));
  });
  server.requestTimeout=10000;server.headersTimeout=10000;
  let closing;
  const dispose=()=>closing??=(async()=>{
    await adapter.dispose();
    for(const client of wss.clients || [])client.terminate?client.terminate():client.close(1000,'ended');
    await new Promise(resolve=>wss.close(()=>resolve()));
    if(server.listening)await new Promise(resolve=>server.close(()=>resolve()));
  })();
  // The operator owns TLS/reverse proxy, explicit listen(), OS signals, and start() authorization.
  return {server,dispose};
}

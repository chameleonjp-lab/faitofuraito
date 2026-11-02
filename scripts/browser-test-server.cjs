/* Playwright's owned local Vite dev server: fixed loopback/port and strict bind. */
const {startLocalViteServer}=require('./browser-check-policy.cjs');
let server;
let closing=false;

async function shutdown(){
 if(closing)return;
 closing=true;
 await server?.close().catch(error=>{console.error(error);process.exitCode=1;});
}

process.once('SIGINT',()=>{void shutdown().finally(()=>process.exit());});
process.once('SIGTERM',()=>{void shutdown().finally(()=>process.exit());});

startLocalViteServer().then(value=>{
 server=value;
 console.log('Playwright Vite server ready at http://127.0.0.1:4177/');
}).catch(error=>{
 console.error(error);
 process.exitCode=1;
});

(()=>{var e,r,t={9232:(e,r,t)=>{"use strict";var o=t(7057),a=t(6542);const s=new a.LuaFactory(o);self.onmessage=({data:e})=>(async e=>{console.clear();const r=await s.createEngine();try{r.global.set("print",(0,a.decorateFunction)(((e,r)=>{const t=[];for(let o=1;o<=r;o++)t.push(e.indexToString(o));console.log(...t),self.postMessage({type:"log",data:t.join("\t")})}),{receiveArgsQuantity:!0,receiveThread:!0})),r.global.set("clear",(()=>{self.postMessage({type:"clear"}),console.clear()}));const t=r.doStringSync(e);t&&self.postMessage({type:"log",data:t})}catch(e){self.postMessage({type:"error",data:e.toString()}),console.error(e)}finally{r.global.close(),self.postMessage({type:"finished"})}})(e)},3945:()=>{},6549:()=>{},2777:()=>{},5432:()=>{},4058:()=>{}},o={};function a(e){var r=o[e];if(void 0!==r)return r.exports;var s=o[e]={exports:{}};return t[e].call(s.exports,s,s.exports,a),s.exports}a.m=t,a.x=()=>{var e=a.O(void 0,[3726],(()=>a(9232)));return a.O(e)},e=[],a.O=(r,t,o,s)=>{if(!t){var n=1/0;for(p=0;p<e.length;p++){for(var[t,o,s]=e[p],c=!0,l=0;l<t.length;l++)(!1&s||n>=s)&&Object.keys(a.O).every((e=>a.O[e](t[l])))?t.splice(l--,1):(c=!1,s<n&&(n=s));if(c){e.splice(p--,1);var i=o();void 0!==i&&(r=i)}}return r}s=s||0;for(var p=e.length;p>0&&e[p-1][2]>s;p--)e[p]=e[p-1];e[p]=[t,o,s]},a.n=e=>{var r=e&&e.__esModule?()=>e.default:()=>e;return a.d(r,{a:r}),r},a.d=(e,r)=>{for(var t in r)a.o(r,t)&&!a.o(e,t)&&Object.defineProperty(e,t,{enumerable:!0,get:r[t]})},a.f={},a.e=e=>Promise.all(Object.keys(a.f).reduce(((r,t)=>(a.f[t](e,r),r)),[])),a.u=e=>e+".app.js",a.g=function(){if("object"==typeof globalThis)return globalThis;try{return this||new Function("return this")()}catch(e){if("object"==typeof window)return window}}(),a.o=(e,r)=>Object.prototype.hasOwnProperty.call(e,r),(()=>{var e;a.g.importScripts&&(e=a.g.location+"");var r=a.g.document;if(!e&&r&&(r.currentScript&&(e=r.currentScript.src),!e)){var t=r.getElementsByTagName("script");t.length&&(e=t[t.length-1].src)}if(!e)throw new Error("Automatic publicPath is not supported in this browser");e=e.replace(/#.*$/,"").replace(/\?.*$/,"").replace(/\/[^\/]+$/,"/"),a.p=e})(),(()=>{var e={8600:1};a.f.i=(r,t)=>{e[r]||importScripts(a.p+a.u(r))};var r=self.webpackChunktry_lua=self.webpackChunktry_lua||[],t=r.push.bind(r);r.push=r=>{var[o,s,n]=r;for(var c in s)a.o(s,c)&&(a.m[c]=s[c]);for(n&&n(a);o.length;)e[o.pop()]=1;t(r)}})(),r=a.x,a.x=()=>a.e(3726).then(r),a.x()})();
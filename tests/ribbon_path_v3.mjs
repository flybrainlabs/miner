import assert from 'node:assert/strict';
import { clippedPath } from '../web/ribbon-path.mjs';
const part={points:new Float32Array([0,0,0,1,0,0,1,1,0,2,1,0]),arcLengths:new Float32Array([0,1,2,3])},segments=[];
clippedPath(part,.1,.9,false,64,(a,b,fa,fb)=>segments.push({a:{...a},b:{...b},fa,fb}));assert.equal(segments.length,3);for(const {a,b,fa,fb}of segments){assert.ok(a.x===b.x||a.y===b.y,'Every centerline segment lies on an original edge, including its sharp corner');assert.ok(fb>=fa);}assert.ok(Math.abs(segments[0].a.x-.3)<1e-6);assert.ok(Math.abs(segments.at(-1).b.x-1.7)<1e-6);
const reversed=[];clippedPath(part,0,1,true,1,(a,b)=>reversed.push([{...a},{...b}]));assert.equal(reversed.length,1);assert.equal(reversed[0][1].x,0);const capped=[];assert.equal(clippedPath(part,0,1,false,1,(a,b)=>capped.push([{...a},{...b}])),2);assert.equal(capped.length,1);assert.equal(capped[0][0].y,1);assert.equal(clippedPath({points:new Float32Array(6),arcLengths:new Float32Array(2)},0,1,false,64,()=>assert.fail()),0);
console.log(JSON.stringify({passed:4,scope:'Original bends, reverse route, bounded head truncation, zero-length path; geometry fixtures, not live evidence'}));

import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSchema} from '../agent/validation.mjs';
const areas={type:'array',minItems:2,maxItems:2,uniqueItems:true,items:{type:'string',minLength:1,maxLength:80}};
test('지역 비교의 두 문자열은 허용하고 개수/타입/중복/제어문자는 거부한다',()=>{
 const input=['애월읍','서귀포시'];assert.equal(validateSchema(input,areas),input);
 for(const value of [null,{},['애월읍'],['애월읍','서귀포시','한림읍'],['애월읍',3],['애월읍','애월읍'],['애월읍',''],['애월읍','서귀포\u0000시']])assert.throws(()=>validateSchema(value,areas),{code:'INVALID_TOOL_ARGUMENTS'});
});
test('비교 배열을 포함해도 알려지지 않은 도구 인자는 계속 거부한다',()=>{
 const schema={type:'object',additionalProperties:false,required:['areas'],properties:{areas}};
 assert.deepEqual(validateSchema({areas:['애월읍','서귀포시']},schema),{areas:['애월읍','서귀포시']});
 for(const extra of [{sql:'SELECT *'},{url:'http://127.0.0.1'},{path:'.env'},{now:'2030-01-01'}])assert.throws(()=>validateSchema({areas:['애월읍','서귀포시'],...extra},schema),{code:'INVALID_TOOL_ARGUMENTS'});
});

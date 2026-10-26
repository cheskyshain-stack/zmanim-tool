import test from 'node:test';
import assert from 'node:assert/strict';
import { seatsSessionValid, SEATS_SESSION_IDLE } from '../js/seats/session.js';

test('a session uses three hours of inactivity and requires its original service and identity', () => {
  const now=Date.parse('2026-10-26T15:00:00Z'),endpoint='https://example.invalid';
  const session={version:1,name:'Synthetic Organizer',endpoint,token:'a'.repeat(64),lastActive:now,expires:now+24*60*60*1000};
  assert.equal(seatsSessionValid(session,endpoint,now+SEATS_SESSION_IDLE-1),true);
  assert.equal(seatsSessionValid(session,endpoint,now+SEATS_SESSION_IDLE),false);
  assert.equal(seatsSessionValid({...session,lastActive:now+2*60*60*1000},endpoint,now+4*60*60*1000),true);
  for(const patch of [{name:''},{lastActive:NaN},{lastActive:now+1},{expires:now},{token:''},{version:0}])assert.equal(seatsSessionValid({...session,...patch},endpoint,now),false);
  assert.equal(seatsSessionValid(session,'https://another.invalid',now),false);
  assert.equal(seatsSessionValid({...session,endpoint:'',token:undefined},'',now),true);
});

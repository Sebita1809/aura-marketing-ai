import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AVATAR_OPTIONS, getAvatarOption } from './avatarOptions.js';

test('AVATAR_OPTIONS tiene 12 opciones con clave, ícono y gradiente únicos', () => {
  assert.equal(AVATAR_OPTIONS.length, 12);
  const keys = AVATAR_OPTIONS.map((o) => o.key);
  assert.equal(new Set(keys).size, 12);
  for (const opt of AVATAR_OPTIONS) {
    assert.ok(opt.icon);
    assert.ok(opt.gradient);
  }
});

test('getAvatarOption devuelve la opción correcta para una clave válida', () => {
  const opt = getAvatarOption('rocket_launch');
  assert.equal(opt.key, 'rocket_launch');
  assert.equal(opt.icon, 'rocket_launch');
});

test('getAvatarOption devuelve null para una clave desconocida', () => {
  assert.equal(getAvatarOption('no-existe'), null);
});

test('getAvatarOption devuelve null para null/undefined sin romper', () => {
  assert.equal(getAvatarOption(null), null);
  assert.equal(getAvatarOption(undefined), null);
});

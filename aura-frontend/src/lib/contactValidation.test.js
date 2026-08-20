import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateName,
  validateEmail,
  validateMessage,
  validateContactPayload,
  NAME_MIN,
  NAME_MAX,
  MESSAGE_MIN,
  MESSAGE_MAX,
} from './contactValidation.js';

test('validateName: nombre válido no da error', () => {
  assert.equal(validateName('Ana'), null);
});

test('validateName: nombre vacío o muy corto da error', () => {
  assert.ok(validateName(''));
  assert.ok(validateName('A'));
});

test('validateName: límites inclusive (NAME_MIN y NAME_MAX)', () => {
  assert.equal(validateName('A'.repeat(NAME_MIN)), null);
  assert.equal(validateName('A'.repeat(NAME_MAX)), null);
  assert.ok(validateName('A'.repeat(NAME_MAX + 1)));
});

test('validateEmail: correo válido no da error', () => {
  assert.equal(validateEmail('ana@empresa.com'), null);
});

test('validateEmail: formato inválido da "Ingresá un correo válido."', () => {
  assert.equal(validateEmail('noesunmail'), 'Ingresá un correo válido.');
});

test('validateMessage: mensaje corto da error indicando el mínimo', () => {
  const error = validateMessage('hola');
  assert.ok(error && error.includes(String(MESSAGE_MIN)));
});

test('validateMessage: límites inclusive (MESSAGE_MIN y MESSAGE_MAX)', () => {
  assert.equal(validateMessage('a'.repeat(MESSAGE_MIN)), null);
  assert.equal(validateMessage('a'.repeat(MESSAGE_MAX)), null);
  assert.ok(validateMessage('a'.repeat(MESSAGE_MAX + 1)));
});

test('validateContactPayload: campo faltante -> valid false (spec: no invoca la Edge Function)', () => {
  const result = validateContactPayload({ name: 'Ana', email: 'ana@empresa.com', message: '' });
  assert.equal(result.valid, false);
});

test('validateContactPayload: payload completo válido -> valid true', () => {
  const result = validateContactPayload({
    name: 'Ana',
    email: 'ana@empresa.com',
    message: 'Quiero información sobre Aura y sus planes disponibles',
  });
  assert.equal(result.valid, true);
});

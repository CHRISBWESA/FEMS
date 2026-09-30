import { BadRequestException } from '@nestjs/common';

// Deliberately short: length matters far more than composition rules, and a list of the passwords attackers try
// first catches most of what length alone does not.
const COMMON = new Set([
  '123456789', '1234567890', '12345678901', '0123456789', 'qwertyuiop', 'qwerty1234', 'qwerty12345', 'password', 'password1', 'password12',
  'password123', 'password1234', 'passw0rd123', 'iloveyou12', 'welcome123', 'welcome1234', 'letmein123', 'admin12345', 'administrator', 'changeme123',
  'fellowship', 'fellowship1', 'fellowship123', 'church12345', 'christian123', 'jesus12345', 'godisgood12', 'abcdefghij', 'abcd123456', '1q2w3e4r5t',
]);

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

export function assertPasswordPolicy(password: unknown, who: { email?: string | null; firstName?: string | null; lastName?: string | null } = {}): string {
  if (typeof password !== 'string') throw new BadRequestException('A password is required.');
  if (password.length < PASSWORD_MIN) throw new BadRequestException(`The password must be at least ${PASSWORD_MIN} characters long.`);
  if (password.length > PASSWORD_MAX) throw new BadRequestException(`The password must be at most ${PASSWORD_MAX} characters long.`);
  const lower = password.toLowerCase();
  if (new Set(lower).size < 5) throw new BadRequestException('The password is too repetitive.');
  if (COMMON.has(lower)) throw new BadRequestException('This password is too common. Choose something less predictable.');
  const parts = [who.email?.split('@')[0], who.firstName, who.lastName].filter((p): p is string => !!p && p.length >= 4).map((p) => p.toLowerCase());
  if (parts.some((p) => lower.includes(p))) throw new BadRequestException('The password must not contain your name or e-mail address.');
  return password;
}

import { describe,expect,it } from 'vitest';
import { GET } from './route';

describe('GET /api/faculties', () => {
  it('should return faculties data successfully', async () => {
    const res = await GET();
    console.log('Status:', res.status);
    const body = await res.json();
    console.log('Body length:', Array.isArray(body) ? body.length : 'not an array');
    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });
});

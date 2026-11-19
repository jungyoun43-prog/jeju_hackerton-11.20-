import { symlink } from 'node:fs/promises';

export async function createFixtureLink(t, target, path, type) {
  // A directory junction exercises the same directory boundary on standard Windows accounts.
  const linkType = process.platform === 'win32' && type === 'dir' ? 'junction' : type;
  try {
    await symlink(target, path, linkType);
    return true;
  } catch (error) {
    if (process.platform !== 'win32' || type !== 'file' || error.code !== 'EPERM') throw error;
    t.skip('Windows에서 파일 심볼릭 링크 생성 권한 없음');
    return false;
  }
}

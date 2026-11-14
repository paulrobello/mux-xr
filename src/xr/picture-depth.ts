export * from '@par/xr-workspace/internal/picture-depth';

/** Why a depth map could not be made, as the frame's notice reads it. */
export function depthFailureNotice(code: string): string {
  switch (code) {
    case 'no-secret':
      return '3D pictures need the Mac paired: set the secret in Settings → Host clipboard';
    case 'disabled':
      return '3D pictures are off on the Mac (start the dictation server with --picture-depth on)';
    case 'auth':
      return 'The Mac rejected the pairing secret for 3D. Check it in Settings → Host clipboard';
    case 'rate-limited':
      return 'Too many 3D requests. Wait a minute and try again';
    case 'too-large':
      return 'Picture is too large to make 3D';
    case 'timeout':
      return 'Making the 3D depth timed out';
    default:
      return 'Could not reach the Mac to make this picture 3D';
  }
}

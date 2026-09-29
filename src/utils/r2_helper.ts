/**
 * Per-User Folder Isolation Utility for Cloudflare R2 Object Storage
 * Structure:
 * users/{cleanHandle}/
 *   ├── profile/
 *   ├── feed/
 *   ├── bazar/
 *   ├── chat/
 *   └── audio/
 */

export class R2UserStorageHelper {
  public static cleanHandle(handle: string): string {
    return handle.replace(/^@+/, '').trim().toLowerCase();
  }

  public static getUserRoot(handle: string): string {
    const clean = this.cleanHandle(handle);
    return `users/@${clean}`;
  }

  public static getProfilePath(handle: string, filename: string): string {
    const root = this.getUserRoot(handle);
    return `${root}/profile/${Date.now()}_${filename}`;
  }

  public static getBazarShopPath(handle: string, shopId: string, filename: string): string {
    const root = this.getUserRoot(handle);
    return `${root}/bazar/shops/${shopId}/${Date.now()}_${filename}`;
  }

  public static getBazarListingPath(handle: string, listingId: string, filename: string): string {
    const root = this.getUserRoot(handle);
    return `${root}/bazar/listings/${listingId}/${Date.now()}_${filename}`;
  }

  public static getFeedPostPath(handle: string, postId: string, filename: string): string {
    const root = this.getUserRoot(handle);
    return `${root}/feed/${postId}/${Date.now()}_${filename}`;
  }

  public static getChatMediaPath(handle: string, chatId: string, filename: string): string {
    const root = this.getUserRoot(handle);
    return `${root}/chat/${chatId}/${Date.now()}_${filename}`;
  }

  public static getAudioPath(handle: string, filename: string): string {
    const root = this.getUserRoot(handle);
    return `${root}/audio/${Date.now()}_${filename}`;
  }
}

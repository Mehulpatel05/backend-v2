export class R2UserStorageHelper {
  public static cleanHandle(handle: string): string {
    return handle.replace(/^@+/, '').trim().toLowerCase();
  }

  public static getUserRoot(handle: string): string {
    const clean = this.cleanHandle(handle);
    return `users/@${clean}`;
  }

  public static getR2Root(handle: string): string {
    return `${this.getUserRoot(handle)}/r2`;
  }

  public static getD1Root(handle: string): string {
    return `${this.getUserRoot(handle)}/d1`;
  }

  public static getProfilePath(handle: string, filename: string): string {
    const root = this.getR2Root(handle);
    return `${root}/profile/${Date.now()}_${filename}`;
  }

  public static getBazarShopPath(handle: string, shopId: string, filename: string): string {
    const root = this.getR2Root(handle);
    return `${root}/bazar/shops/${shopId}/${Date.now()}_${filename}`;
  }

  public static getBazarListingPath(handle: string, listingId: string, filename: string): string {
    const root = this.getR2Root(handle);
    return `${root}/bazar/listings/${listingId}/${Date.now()}_${filename}`;
  }

  public static getFeedPostPath(handle: string, postId: string, filename: string): string {
    const root = this.getR2Root(handle);
    return `${root}/feed/${postId}/${Date.now()}_${filename}`;
  }

  public static getChatMediaPath(handle: string, chatId: string, filename: string): string {
    const root = this.getR2Root(handle);
    return `${root}/chat/${chatId}/${Date.now()}_${filename}`;
  }

  public static getAudioPath(handle: string, filename: string): string {
    const root = this.getR2Root(handle);
    return `${root}/audio/${Date.now()}_${filename}`;
  }

  public static getMiscPath(handle: string, filename: string): string {
    const root = this.getR2Root(handle);
    return `${root}/misc/${Date.now()}_${filename}`;
  }

  public static getD1DataPath(handle: string, dataType: string): string {
    const root = this.getD1Root(handle);
    return `${root}/${dataType}.json`;
  }
}

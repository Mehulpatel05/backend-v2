export interface OfficialStarterPost {
  id: string;
  authorHandle: string;
  content: string;
  category: string;
  cityId: string;
  areaId: string;
  areaName: string;
  postType: string;
  isPinned: number;
}

export const OFFICIAL_STARTER_POSTS: OfficialStarterPost[] = [
  {
    id: 'post_official_vadodara_emergency_101',
    authorHandle: 'nearhood_team',
    content: `🚨 VADODARA EMERGENCY HELPLINE DIRECTORY (SAVE THIS)

Verified numbers for all Vadodara citizens:
• VMC Central Control Room: 1800-233-0266 / 0265-2421414
• SSG Civil Hospital Casualty (24/7): 0265-2424848
• Vadodara City Police Control Room: 112 / 0265-2415111
• Fire & Emergency Services: 101 / 0265-2422222
• Torrent Power 24/7 Emergency: 0265-2792525 / 19123
• Vadodara Gas (VGL) Leakage Helpline: 0265-2441111 / 1800-233-0101
• Women Helpline / Abhayam: 181
• Childline Helpline: 1098

Keep this handy. Report any urgent local safety matters directly in Nearhood Alerts category.`,
    category: 'alerts',
    cityId: 'GJ-VAD',
    areaId: 'GJ-VAD-ALKAPURI',
    areaName: 'All Vadodara',
    postType: 'official',
    isPinned: 1,
  },
  {
    id: 'post_official_vmc_waste_collection_102',
    authorHandle: 'nearhood_team',
    content: `♻️ VMC DOOR-TO-DOOR WASTE COLLECTION & CIVIC WARD TIMINGS

Vadodara Municipal Corporation morning waste collection timings:
• Residential Morning Collection: 7:00 AM – 10:30 AM
• Wet Waste (Green Bin) & Dry Waste (Blue Bin) segregation is mandatory.

Major VMC Ward Civic Centers for Property Tax & Certificates:
1. West Zone: Akota Ward Office (Near Akota Stadium)
2. Central Zone: Khanderao Market Main Office
3. North Zone: Karelibaug Civic Center (Water Tank Road)
4. South Zone: Manjalpur Ward Office (Near Darbar Chokdi)

Timings: Monday to Saturday 10:30 AM to 5:00 PM. Clean Vadodara, Green Vadodara!`,
    category: 'services',
    cityId: 'GJ-VAD',
    areaId: 'GJ-VAD-KARELIBAUG',
    areaName: 'All Vadodara',
    postType: 'official',
    isPinned: 0,
  },
  {
    id: 'post_official_sayaji_heritage_guide_103',
    authorHandle: 'nearhood_team',
    content: `🌳 SAYAJI BAUG & VADODARA HERITAGE VISITORS GUIDE

Key visiting hours and tips for Sayaji Baug (Kamati Baug):
• Kamati Baug Main Garden: Open daily 06:00 AM – 08:30 PM (Free Entry)
• Sayaji Baug Zoo: 09:00 AM – 06:00 PM (Closed on Thursdays)
• Sardar Patel Planetarium: Shows at 04:00 PM (Gujarati) and 05:00 PM (English)
• Joy Train (Sayaji Express): Operates 10:00 AM – 06:30 PM
• Baroda Museum and Picture Gallery: 10:30 AM – 05:00 PM (Monday-Sunday)

Tip: Early morning joggers and walkers enjoy pleasant lake breeze between 6:00 AM and 8:00 AM.`,
    category: 'events',
    cityId: 'GJ-VAD',
    areaId: 'GJ-VAD-SAYAJIGUNJ',
    areaName: 'Sayajigunj',
    postType: 'official',
    isPinned: 0,
  },
  {
    id: 'post_official_welcome_nearhood_104',
    authorHandle: 'nearhood_team',
    content: `👋 WELCOME TO NEARHOOD VADODARA!

Welcome to your hyper-local neighborhood community app for Vadodara!

How to make the most of Nearhood:
1. Ask local questions: Seeking a trusted doctor, tutor, or maid in your locality? Post under "Questions".
2. Support neighborhood businesses: Browse verified local stores and resident listings in Bazaar.
3. Stay informed: Check city alerts, events, and community updates from fellow Barodians.
4. Keep it neighborly: Keep discussions respectful, helpful, and authentic.

Let us build a closer, safer, and well-connected Vadodara together!`,
    category: 'general',
    cityId: 'GJ-VAD',
    areaId: 'GJ-VAD-ALKAPURI',
    areaName: 'All Vadodara',
    postType: 'official',
    isPinned: 0,
  },
];

export async function seedOfficialStarterFeed(db: any): Promise<{ inserted: number }> {
  let inserted = 0;

  try {
    await db.prepare(
      `INSERT INTO users (id, phone, handle, is_verified, created_at, updated_at)
       VALUES ('usr_nearhood_team', '0000000000', 'nearhood_team', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(phone) DO UPDATE SET is_verified = 1`
    ).run();

    await db.prepare(
      `INSERT INTO profiles (
        handle, user_id, display_name, bio, is_verified, home_city_id, home_area_name, created_at, updated_at
      ) VALUES (
        'nearhood_team', 'usr_nearhood_team', 'Nearhood Vadodara Team',
        'Official neighborhood updates, civic directories, and community guides for Vadodara.',
        1, 'GJ-VAD', 'All Vadodara', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT(handle) DO UPDATE SET
        is_verified = 1,
        display_name = 'Nearhood Vadodara Team'`
    ).run();
  } catch (e) {
    console.error('[Official Profile Seed Error]:', e);
  }

  for (const post of OFFICIAL_STARTER_POSTS) {
    try {
      await db.prepare(
        `INSERT INTO feed_posts (
          id, author_handle, content, category, city_id, area_id, area_name,
          post_type, is_pinned, likes_count, comments_count, created_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, 0, 0, CURRENT_TIMESTAMP
        )
        ON CONFLICT(id) DO UPDATE SET
          content = excluded.content,
          category = excluded.category,
          is_pinned = excluded.is_pinned,
          post_type = excluded.post_type`
      )
        .bind(
          post.id,
          post.authorHandle,
          post.content,
          post.category,
          post.cityId,
          post.areaId,
          post.areaName,
          post.postType,
          post.isPinned
        )
        .run();
      inserted++;
    } catch (e) {
      console.error(`[Official Post Seed Error for ${post.id}]:`, e);
    }
  }

  return { inserted };
}

import { prisma } from "@/lib/db";

export async function getFavoriteSpaceIds(userId: string): Promise<Set<string>> {
  const favorites = await prisma.spaceFavorite.findMany({ where: { userId }, select: { spaceId: true } });
  return new Set(favorites.map(favorite => favorite.spaceId));
}

"use server";

import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { deleteFromGCS } from "@/lib/gcs";
import { hasAnyRole, MANAGE_ROLES } from "@/lib/roles";

async function isAuthorized() {
  const session = await auth();
  return hasAnyRole(session?.user, MANAGE_ROLES);
}

export async function getMediaRegistry(folderId: string | null = null) {
  if (!(await isAuthorized())) throw new Error("Unauthorized");
  
  const folders = await prisma.mediaFolder.findMany({
    where: { parentId: folderId },
    orderBy: { name: "asc" },
  });
  
  const media = await prisma.media.findMany({
    where: { folderId },
    orderBy: { createdAt: "desc" },
  });
  
  return { folders, media };
}

export async function createFolder(name: string, parentId: string | null = null) {
  if (!(await isAuthorized())) throw new Error("Unauthorized");
  
  const folder = await prisma.mediaFolder.create({
    data: {
      name,
      parentId,
    },
  });
  
  revalidatePath("/media");
  return folder;
}

export async function registerMedia(data: { name: string, url: string, type: string, size?: number, folderId?: string | null }) {
  if (!(await isAuthorized())) throw new Error("Unauthorized");
  
  const media = await prisma.media.create({
    data: {
      name: data.name,
      url: data.url,
      type: data.type,
      size: data.size,
      folderId: data.folderId,
    },
  });
  
  revalidatePath("/media");
  return media;
}

export async function deleteMedia(id: string) {
  if (!(await isAuthorized())) throw new Error("Unauthorized");
  const media = await prisma.media.findUnique({ where: { id }, select: { url: true } });
  if (media?.url) await deleteFromGCS(media.url);
  await prisma.media.delete({ where: { id } });
  revalidatePath("/media");
}

export async function deleteFolder(id: string) {
  if (!(await isAuthorized())) throw new Error("Unauthorized");
  // Prisma will cascade delete children folders and media due to SetNull/Cascade if configured, 
  // but let's be careful. Media model has folderId SetNull.
  await prisma.mediaFolder.delete({ where: { id } });
  revalidatePath("/media");
}

export async function renameFolder(id: string, name: string) {
  if (!(await isAuthorized())) throw new Error("Unauthorized");
  await prisma.mediaFolder.update({
    where: { id },
    data: { name },
  });
  revalidatePath("/media");
}

export async function moveMedia(mediaId: string, folderId: string | null) {
  if (!(await isAuthorized())) throw new Error("Unauthorized");
  await prisma.media.update({
    where: { id: mediaId },
    data: { folderId },
  });
  revalidatePath("/media");
}

export async function getFolderAncestors(id: string) {
  if (!(await isAuthorized())) throw new Error("Unauthorized");
  const path = [];
  let currentId = id;
  while (currentId) {
    const folder = await prisma.mediaFolder.findUnique({
      where: { id: currentId },
      select: { id: true, name: true, parentId: true },
    });
    if (!folder) break;
    path.unshift(folder);
    currentId = folder.parentId as any;
  }
  return path;
}

export async function toggleDownloadable(mediaId: string) {
  if (!(await isAuthorized())) throw new Error("Unauthorized");
  const item = await prisma.media.findUnique({ where: { id: mediaId }, select: { downloadable: true } });
  if (!item) throw new Error("Not found");
  const updated = await prisma.media.update({
    where: { id: mediaId },
    data: { downloadable: !item.downloadable },
  });
  revalidatePath("/media");
  revalidatePath("/assets");
  return updated;
}

export async function updateMediaDescription(mediaId: string, description: string) {
  if (!(await isAuthorized())) throw new Error("Unauthorized");
  const updated = await prisma.media.update({
    where: { id: mediaId },
    data: { description: description || null },
  });
  revalidatePath("/media");
  revalidatePath("/assets");
  return updated;
}

export async function getDownloadableFiles() {
  return prisma.media.findMany({
    where: { downloadable: true },
    orderBy: { createdAt: "desc" },
  });
}

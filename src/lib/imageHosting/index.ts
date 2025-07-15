import { uploadImageByGithub } from "./github";
import { uploadImageBySmms } from "./smms";
import { uploadImageByPicgo } from "./picgo";
import { Store } from "@tauri-apps/plugin-store";

export async function uploadImage(file: File) {
  const store = await Store.load('store.json');
  const mainImageHosting = await store.get('mainImageHosting')
  switch (mainImageHosting) {
    case 'github':
      return uploadImageByGithub(file)
    case 'smms':
      return uploadImageBySmms(file)
    case 'picgo':
      return uploadImageByPicgo(file)
    default:
      return undefined
  }
}
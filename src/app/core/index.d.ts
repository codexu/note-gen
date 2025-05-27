declare module "note-gen/screenshot" {
    export interface ScreenshotImage {
        name: string;
        path: string;
        width: number;
        height: number;
        x: number;
        y: number;
        z: number;
    }
}
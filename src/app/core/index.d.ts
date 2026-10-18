declare module "note-gen/screenshot" {
    export interface ScreenshotImage {
        capture_id: string;
        name: string;
        path: string;
        source: 'window' | 'display';
        width: number;
        height: number;
        x: number;
        y: number;
        z: number;
    }
}

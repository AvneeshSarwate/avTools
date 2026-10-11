// Test-only external receiver: pixel readback verifies transport, never publishes.
// Does not create windows or activate an app.
#import <Foundation/Foundation.h>
#import <Metal/Metal.h>
#import <Syphon/SyphonMetalClient.h>
#import "SyphonServerDirectory.h"
#include <cstdio>
#include <csignal>
#include <cstring>
static volatile sig_atomic_t running = 1;
static void stopReceiver(int) { running = 0; }
int main(int argc, const char** argv) {
    signal(SIGTERM, stopReceiver);
    signal(SIGINT, stopReceiver);
    @autoreleasepool {
        if (argc < 2) return 2;
        bool named = strcmp(argv[1], "--name") == 0;
        bool timed = argc > 4 && strcmp(argv[4], "--timed") == 0;
        double duration = named && argc > 3 ? atof(argv[3]) : (argc > 2 ? atof(argv[2]) : 30);
        NSDictionary* description = nil;
        if (named) {
            if (argc < 3) return 2;
            SyphonServerDirectory* directory = [SyphonServerDirectory sharedDirectory];
            puts("{\"waiting\":true}"); fflush(stdout);
            NSDate* deadline = [NSDate dateWithTimeIntervalSinceNow:10];
            while (!description && [deadline timeIntervalSinceNow] > 0) {
                [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.005]];
                description = [[directory serversMatchingName:[NSString stringWithUTF8String:argv[2]] appName:nil] firstObject];
            }
            if (!description) { fprintf(stderr,"Could not discover named Syphon server\n"); return 3; }
        } else {
            NSData* data = [NSData dataWithContentsOfFile:[NSString stringWithUTF8String:argv[1]]];
            description = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
        }
        fprintf(stderr,"Server: %s\n", [[description description] UTF8String]);
        id<MTLDevice> device = MTLCreateSystemDefaultDevice();
        id<MTLCommandQueue> queue = [device newCommandQueue];
        SyphonMetalClient* client = [[SyphonMetalClient alloc] initWithServerDescription:description device:device options:nil newFrameHandler:nil];
        if (!client || !client.isValid) { fprintf(stderr, "Syphon receiver could not connect\n"); return 3; }
        puts("{\"ready\":true}"); fflush(stdout);
        NSDate* end = [NSDate dateWithTimeIntervalSinceNow:duration];
        while (running && [end timeIntervalSinceNow] > 0 && client.isValid) {
            @autoreleasepool {
                [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.002]];
                if (!client.hasNewFrame) continue;
                id<MTLTexture> texture = [client newFrameImage];
                if (!texture) continue;
                NSUInteger row = ((texture.width * 4 + 255) / 256) * 256;
                id<MTLBuffer> pixels = [device newBufferWithLength:row * texture.height options:MTLResourceStorageModeShared];
                id<MTLCommandBuffer> commands = [queue commandBuffer];
                id<MTLBlitCommandEncoder> blit = [commands blitCommandEncoder];
                [blit copyFromTexture:texture sourceSlice:0 sourceLevel:0 sourceOrigin:MTLOriginMake(0,0,0)
                    sourceSize:MTLSizeMake(texture.width,texture.height,1) toBuffer:pixels destinationOffset:0
                    destinationBytesPerRow:row destinationBytesPerImage:row * texture.height];
                [blit endEncoding]; [commands commit]; [commands waitUntilCompleted];
                if (commands.status == MTLCommandBufferStatusError) return 4;
                const unsigned char* bytes = (const unsigned char*)pixels.contents;
                bool bgra = texture.pixelFormat == MTLPixelFormatBGRA8Unorm;
                unsigned top[4], bottom[4];
                for (unsigned c=0;c<4;c++) {
                    unsigned component = bgra && c != 1 && c != 3 ? 2-c : c;
                    top[c] = bytes[row + 4 + component];
                    bottom[c] = bytes[row * (texture.height-2) + 4 + component];
                }
                printf("{\"width\":%lu,\"height\":%lu,\"top\":[%u,%u,%u,%u],\"bottom\":[%u,%u,%u,%u]",
                    (unsigned long)texture.width,(unsigned long)texture.height,top[0],top[1],top[2],top[3],bottom[0],bottom[1],bottom[2],bottom[3]);
                if (timed) printf(",\"receivedMs\":%.3f", [[NSDate date] timeIntervalSince1970] * 1000.0);
                puts("}");
                fflush(stdout); [pixels release]; [texture release];
            }
        }
        [client stop]; [client release]; [queue release]; [device release];
    }
}

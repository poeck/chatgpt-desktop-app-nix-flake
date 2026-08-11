{
  description = "Nix flake for OpenAI's official ChatGPT Desktop App for Linux";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      lib = nixpkgs.lib;
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];

      forAllSystems =
        f:
        lib.genAttrs systems (
          system:
          let
            pkgs = import nixpkgs {
              inherit system;
              config.allowUnfree = true;
            };
          in
          f system pkgs
        );
    in
    {
      packages = forAllSystems (
        _system: pkgs:
        rec {
          chatgpt-desktop-app = pkgs.callPackage ./pkgs/chatgpt-desktop-app { };
          chatgpt = chatgpt-desktop-app;
          default = chatgpt-desktop-app;
        }
      );

      apps = forAllSystems (
        system: _pkgs:
        rec {
          chatgpt-desktop-app = {
            type = "app";
            program = "${self.packages.${system}.chatgpt-desktop-app}/bin/chatgpt";
            meta.description = "Launch the official ChatGPT Desktop App";
          };
          chatgpt = chatgpt-desktop-app;
          default = chatgpt-desktop-app;
        }
      );

      checks = forAllSystems (system: _pkgs: {
        chatgpt-desktop-app = self.packages.${system}.chatgpt-desktop-app;
      });

      overlays.default = final: _prev: {
        chatgpt-desktop-app = final.callPackage ./pkgs/chatgpt-desktop-app { };
      };

      nixosModules.default = import ./modules/nixos;
      nixosModules.chatgpt-desktop-app = self.nixosModules.default;
    };
}

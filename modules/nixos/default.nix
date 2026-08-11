{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.programs.chatgpt-desktop-app;
in
{
  options.programs.chatgpt-desktop-app = {
    enable = lib.mkEnableOption "OpenAI's official ChatGPT Desktop App";

    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.chatgpt-desktop-app or (pkgs.callPackage ../../pkgs/chatgpt-desktop-app { });
      defaultText = lib.literalExpression "pkgs.chatgpt-desktop-app";
      description = "ChatGPT Desktop App package to install.";
    };
  };

  config = lib.mkIf cfg.enable {
    environment.systemPackages = [ cfg.package ];

    xdg.portal.enable = lib.mkDefault true;
    xdg.portal.extraPortals = lib.mkDefault [ pkgs.xdg-desktop-portal-gtk ];
  };
}

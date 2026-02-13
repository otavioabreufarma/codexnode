using System;
using System.Collections.Generic;
using Newtonsoft.Json;
using Oxide.Core;
using Oxide.Core.Libraries.Covalence;

namespace Oxide.Plugins
{
    [Info("VipIntegration", "Codex", "1.0.0")]
    [Description("Integração VIP com backend HTTP para múltiplos servidores Rust")]
    public class VipIntegration : CovalencePlugin
    {
        private Configuration config;

        private class Configuration
        {
            public string ServerId = "server1";
            public string BackendUrl = "https://seu-backend.discloud.app";
            public string ApiToken = "";
            public float CheckInterval = 30f;
        }

        protected override void LoadDefaultConfig()
        {
            config = new Configuration();
            SaveConfig();
        }

        protected override void LoadConfig()
        {
            base.LoadConfig();
            config = Config.ReadObject<Configuration>();
            if (config == null)
            {
                PrintWarning("Config inválida, recriando...");
                LoadDefaultConfig();
            }
            SaveConfig();
        }

        protected override void SaveConfig() => Config.WriteObject(config, true);

        private void Init()
        {
            AddCovalenceCommand("vip.apply", "CmdApplyVip");
            AddCovalenceCommand("vip.remove", "CmdRemoveVip");
            AddCovalenceCommand("vip.status", "CmdVipStatus");
            timer.Every(config.CheckInterval, PollOnlinePlayersStatus);
        }

        private Dictionary<string, string> BuildHeaders()
        {
            return new Dictionary<string, string>
            {
                ["Content-Type"] = "application/json",
                ["x-api-token"] = config.ApiToken
            };
        }

        private void CmdApplyVip(IPlayer player, string command, string[] args)
        {
            if (args.Length < 2)
            {
                player.Reply("Uso: vip.apply <steamId> <vip|vip+>");
                return;
            }

            var payload = new
            {
                serverId = config.ServerId,
                steamId = args[0],
                vipType = args[1]
            };

            webrequest.Enqueue(
                config.BackendUrl + "/plugin/apply-vip",
                JsonConvert.SerializeObject(payload),
                (code, response) =>
                {
                    player.Reply(code == 200 ? "VIP aplicado com sucesso." : $"Erro ao aplicar VIP ({code}): {response}");
                },
                this,
                RequestMethod.POST,
                BuildHeaders()
            );
        }

        private void CmdRemoveVip(IPlayer player, string command, string[] args)
        {
            if (args.Length < 1)
            {
                player.Reply("Uso: vip.remove <steamId>");
                return;
            }

            var payload = new
            {
                serverId = config.ServerId,
                steamId = args[0]
            };

            webrequest.Enqueue(
                config.BackendUrl + "/plugin/remove-vip",
                JsonConvert.SerializeObject(payload),
                (code, response) =>
                {
                    player.Reply(code == 200 ? "VIP removido com sucesso." : $"Erro ao remover VIP ({code}): {response}");
                },
                this,
                RequestMethod.POST,
                BuildHeaders()
            );
        }

        private void CmdVipStatus(IPlayer player, string command, string[] args)
        {
            if (args.Length < 1)
            {
                player.Reply("Uso: vip.status <steamId>");
                return;
            }

            var url = $"{config.BackendUrl}/plugin/vip-status?serverId={config.ServerId}&steamId={args[0]}";
            webrequest.Enqueue(url, null, (code, response) =>
            {
                if (code != 200)
                {
                    player.Reply($"Erro ao consultar status ({code}): {response}");
                    return;
                }

                player.Reply("Status VIP: " + response);
            }, this, RequestMethod.GET, BuildHeaders());
        }

        private void PollOnlinePlayersStatus()
        {
            foreach (var p in players.Connected)
            {
                var steamId = p.Id;
                var url = $"{config.BackendUrl}/plugin/vip-status?serverId={config.ServerId}&steamId={steamId}";

                webrequest.Enqueue(url, null, (code, response) =>
                {
                    if (code != 200 || string.IsNullOrEmpty(response)) return;

                    try
                    {
                        var parsed = JsonConvert.DeserializeObject<Dictionary<string, object>>(response);
                        var hasVip = parsed.ContainsKey("hasVip") && Convert.ToBoolean(parsed["hasVip"]);

                        if (hasVip)
                        {
                            server.Command($"oxide.grant user {steamId} vip");
                        }
                        else
                        {
                            server.Command($"oxide.revoke user {steamId} vip");
                        }
                    }
                    catch (Exception ex)
                    {
                        PrintWarning("Erro ao processar retorno VIP: " + ex.Message);
                    }
                }, this, RequestMethod.GET, BuildHeaders());
            }
        }
    }
}
